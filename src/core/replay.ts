import {
  encodeReplayImageRecord,
  encodeReplayPointerRecords,
  type FTReplayPointerRecord,
} from './replay-encoding.js';
import type { FTNativeTransport } from './transport.js';
import type {
  FTCapturedFrame,
  FTHybridSessionReplayConfig,
  FTPrivacyRegion,
  FTRUMContext,
  FTSessionReplayConfig,
  FTStoredFrame,
} from './types.js';
import { captureFps, samplingRate } from './validation.js';

export interface FTCanvasCapture {
  capture(maxImageDimension: number): Promise<FTCapturedFrame | undefined>;
  persist(frame: FTCapturedFrame, fingerprint: string): Promise<FTStoredFrame>;
  disposeStoredFrame(frame: FTStoredFrame): void;
  setPrivacy(node: unknown, mode: 'mask' | 'hide' | 'unmask'): void;
}

export interface FTReplayPointerEvent {
  eventType: 'down' | 'up' | 'move';
  pointerId: number;
  normalizedX: number;
  normalizedY: number;
  timestamp: number;
}

export interface FTReplayPointerSource {
  onReplayPointer(callback: (event: FTReplayPointerEvent) => void): () => void;
}

const MAX_PENDING_POINTER_EVENTS = 512;

/** Cocos canvas Session Replay controls. */
export class FTSessionReplay {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private busy = false;
  private running = false;
  private mode: 'idle' | 'standalone' | 'hybrid' = 'idle';
  private hybridReplayEnabled = false;
  private captureGeneration = 0;
  private config: Required<Pick<FTSessionReplayConfig, 'captureFps' | 'maxImageDimension'>> = {
    captureFps: 1,
    maxImageDimension: 720,
  };
  private lastFingerprint: string | undefined;
  private lastContextKey: string | undefined;
  private recordCounts = new Map<string, number>();
  private recordTouches = false;
  private pendingPointerEvents: FTReplayPointerEvent[] = [];
  private stopPointerTracking: (() => void) | undefined;

  constructor(
    private readonly transport: FTNativeTransport,
    private readonly capture: FTCanvasCapture,
    private readonly pointerSource?: FTReplayPointerSource,
  ) {}

  /**
   * Enables native Session Replay and starts Cocos canvas capture for a
   * standalone application.
   *
   * @param config - Replay sampling, capture, and touch-privacy settings.
   */
  start(config: FTSessionReplayConfig = {}): void {
    if (this.mode === 'hybrid') {
      throw new Error('Hybrid Replay is managed by guanceSdk.enterCocos() and leaveCocos()');
    }
    if (this.mode === 'standalone') return;
    samplingRate(config.sampleRate, 'replay.sampleRate');
    samplingRate(config.sessionOnErrorSampleRate, 'replay.sessionOnErrorSampleRate');
    this.configureCapture(config);
    this.transport.invoke('replay.configure', config as never);
    this.mode = 'standalone';
    this.startCapture();
  }

  /** @internal */
  attachHybrid(config?: FTHybridSessionReplayConfig): void {
    if (this.mode === 'standalone') {
      throw new Error('Standalone Replay and Hybrid Replay are mutually exclusive');
    }
    if (this.mode === 'hybrid') return;
    this.configureCapture(config || {});
    this.hybridReplayEnabled = config !== undefined;
    this.mode = 'hybrid';
  }

  /** @internal */
  detachHybrid(): void {
    if (this.mode !== 'hybrid') return;
    this.stopCapture();
    this.hybridReplayEnabled = false;
    this.mode = 'idle';
  }

  /** @internal */
  enterHybrid(): void {
    if (this.mode !== 'hybrid') {
      throw new Error('Call guanceSdk.attach() before entering Hybrid Replay');
    }
    if (!this.hybridReplayEnabled || this.running) return;
    this.transport.invoke('hybrid.setExternalRecorderActive', { active: true });
    this.startCapture();
  }

  /** @internal */
  leaveHybrid(): void {
    if (this.mode !== 'hybrid' || !this.hybridReplayEnabled) return;
    this.stopCapture();
    this.transport.invoke('hybrid.setExternalRecorderActive', { active: false });
  }

  private configureCapture(config: FTHybridSessionReplayConfig): void {
    if (config.touchPrivacy !== undefined && config.touchPrivacy !== 'show' && config.touchPrivacy !== 'hide') {
      throw new TypeError("touchPrivacy must be either 'show' or 'hide'");
    }
    this.config = {
      captureFps: captureFps(config.captureFps),
      maxImageDimension: config.maxImageDimension ?? 720,
    };
    this.recordTouches = config.touchPrivacy === 'show';
    if (this.config.maxImageDimension < 1 || this.config.maxImageDimension > 2048) {
      throw new RangeError('maxImageDimension must be between 1 and 2048');
    }
  }

  /** Stops standalone Cocos canvas capture and native Session Replay. */
  stop(): void {
    if (this.mode === 'hybrid') {
      throw new Error('Hybrid Replay is managed by guanceSdk.enterCocos() and leaveCocos()');
    }
    if (this.mode === 'idle') return;
    this.stopCapture();
    this.transport.invoke('replay.stop');
    this.mode = 'idle';
  }

  /**
   * Changes the Session Replay privacy treatment for a Cocos node.
   *
   * `mask` obscures the node, `hide` removes the region from the replay, and
   * `unmask` clears an earlier override. The node must belong to the active
   * Cocos scene.
   *
   * @param node - Cocos node whose rendered bounds receive the privacy rule.
   * @param mode - Privacy treatment to apply.
   */
  setPrivacy(node: unknown, mode: 'mask' | 'hide' | 'unmask'): void {
    this.capture.setPrivacy(node, mode);
  }

  /** @internal */
  async captureNow(): Promise<boolean> {
    if (this.busy) return false;
    const generation = this.captureGeneration;
    this.busy = true;
    let stored: FTStoredFrame | undefined;
    try {
      const context = this.readContext();
      if (!context) return false;
      const frame = await this.capture.capture(this.config.maxImageDimension);
      if (generation !== this.captureGeneration) return false;
      if (!frame) return false;
      applyPrivacyRegions(frame.rgba, frame.width, frame.height, frame.privacyRegions || []);
      const fingerprint = frameFingerprint(frame.rgba);
      const contextKey = `${context.applicationId}:${context.sessionId}:${context.viewId}`;
      if (fingerprint === this.lastFingerprint && contextKey === this.lastContextKey) {
        return this.writePendingPointers(context, frame.width, frame.height);
      }
      stored = await this.capture.persist(frame, fingerprint);
      if (generation !== this.captureGeneration) return false;
      const resourceId = this.transport.invoke('replay.saveImage', {
        path: stored.path,
        width: stored.width,
        height: stored.height,
      }) as string | undefined;
      if (!resourceId) return false;

      const pendingPointers = this.scaledPendingPointers(stored.width, stored.height);
      const encoded = encodeReplayImageRecord({
        context,
        resourceId,
        width: stored.width,
        height: stored.height,
        // Android's native replay resource writer stores WebP images but its
        // wireframe protocol intentionally omits mimeType. The player infers
        // the format from the uploaded resource. Apple resources are PNG and
        // follow the iOS wireframe contract by declaring image/png.
        ...(this.transport.platform === 'ios' ? { mimeType: 'image/png' as const } : {}),
        timestamp: stored.timestamp,
        contextChanged: contextKey !== this.lastContextKey,
        pointerEvents: pendingPointers,
      });
      this.transport.invoke('replay.writeSegment', {
        viewId: context.viewId,
        segment: encoded.segment,
      });
      this.updateRecordCount(context.viewId, encoded.recordCount);
      this.pendingPointerEvents.splice(0, pendingPointers.length);
      this.lastFingerprint = fingerprint;
      this.lastContextKey = contextKey;
      return true;
    } finally {
      if (stored) this.capture.disposeStoredFrame(stored);
      this.busy = false;
    }
  }

  private startCapture(): void {
    this.captureGeneration += 1;
    this.running = true;
    this.lastFingerprint = undefined;
    this.lastContextKey = undefined;
    this.recordCounts.clear();
    this.pendingPointerEvents = [];
    if (this.recordTouches && this.pointerSource) {
      this.stopPointerTracking = this.pointerSource.onReplayPointer((event) => {
        this.pendingPointerEvents.push(event);
        if (this.pendingPointerEvents.length > MAX_PENDING_POINTER_EVENTS) {
          this.pendingPointerEvents.splice(0, this.pendingPointerEvents.length - MAX_PENDING_POINTER_EVENTS);
        }
      });
    }
    this.schedule(0, this.captureGeneration);
  }

  private stopCapture(): void {
    this.captureGeneration += 1;
    this.running = false;
    this.stopPointerTracking?.();
    this.stopPointerTracking = undefined;
    this.pendingPointerEvents = [];
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private schedule(delay: number, generation: number): void {
    if (!this.running) return;
    this.timer = setTimeout(async () => {
      if (!this.running || generation !== this.captureGeneration) return;
      try {
        await this.captureNow();
      } catch (error) {
        this.stopCapture();
        console.error('[cocos-sdk] Session Replay capture stopped:', error);
      } finally {
        if (this.running && generation === this.captureGeneration) {
          this.schedule(1000 / this.config.captureFps, generation);
        }
      }
    }, delay);
  }

  private readContext(): FTRUMContext | undefined {
    const value = this.transport.invoke('replay.getContext') as unknown;
    return normalizeRumContext(value);
  }

  private writePendingPointers(context: FTRUMContext, width: number, height: number): boolean {
    const pointerEvents = this.scaledPendingPointers(width, height);
    if (pointerEvents.length === 0) return false;
    const encoded = encodeReplayPointerRecords({ context, pointerEvents });
    this.transport.invoke('replay.writeSegment', {
      viewId: context.viewId,
      segment: encoded.segment,
    });
    this.updateRecordCount(context.viewId, encoded.recordCount);
    this.pendingPointerEvents.splice(0, pointerEvents.length);
    return true;
  }

  private scaledPendingPointers(width: number, height: number): FTReplayPointerRecord[] {
    return this.pendingPointerEvents.map((event) => ({
      eventType: event.eventType,
      pointerId: event.pointerId,
      x: Math.round(clamp(event.normalizedX, 0, 1) * width),
      y: Math.round(clamp(event.normalizedY, 0, 1) * height),
      timestamp: event.timestamp,
    }));
  }

  private updateRecordCount(viewId: string, added: number): void {
    const count = (this.recordCounts.get(viewId) || 0) + added;
    this.recordCounts.set(viewId, count);
    this.transport.invoke('replay.setRecordCount', { viewId, count });
  }
}

function normalizeRumContext(value: unknown): FTRUMContext | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const context = value as Record<string, unknown>;
  const applicationId = stringValue(context.applicationId, context.application_id);
  const sessionId = stringValue(context.sessionId, context.session_id);
  const viewId = stringValue(context.viewId, context.view_id);
  if (!applicationId || !sessionId || !viewId) return undefined;
  const globalContext = context.globalContext;
  return {
    applicationId,
    sessionId,
    viewId,
    ...(globalContext && typeof globalContext === 'object'
      ? { globalContext: globalContext as FTRUMContext['globalContext'] }
      : {}),
  };
}

function stringValue(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.length > 0);
}

export function frameFingerprint(bytes: Uint8Array): string {
  let hash = 2166136261;
  const stride = Math.max(1, Math.floor(bytes.length / 8192));
  for (let index = 0; index < bytes.length; index += stride) {
    hash ^= bytes[index] || 0;
    hash = Math.imul(hash, 16777619);
  }
  return `${bytes.length.toString(16)}-${(hash >>> 0).toString(16)}`;
}

export function applyPrivacyRegions(
  rgba: Uint8Array,
  width: number,
  height: number,
  regions: FTPrivacyRegion[],
): void {
  regions.forEach((region) => {
    const startX = clamp(Math.floor(region.x), 0, width);
    const startY = clamp(Math.floor(region.y), 0, height);
    const endX = clamp(Math.ceil(region.x + region.width), 0, width);
    const endY = clamp(Math.ceil(region.y + region.height), 0, height);
    const color = region.mode === 'hide' ? 0 : 128;
    for (let y = startY; y < endY; y += 1) {
      for (let x = startX; x < endX; x += 1) {
        const offset = (y * width + x) * 4;
        rgba[offset] = color;
        rgba[offset + 1] = color;
        rgba[offset + 2] = color;
        rgba[offset + 3] = 255;
      }
    }
  });
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
