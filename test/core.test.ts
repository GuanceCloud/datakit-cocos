import { describe, expect, it } from 'vitest';
import { FTDefaultAutoTracking, type FTEngineTrackingHooks } from '../src/core/auto-tracking';
import { FTCocosSDK, type FTAutoTrackingController } from '../src/core/client';
import { FTLogger, FTMobileAgent, FTRUM, FTTrace } from '../src/core/modules';
import { encodeReplayImageRecord } from '../src/core/replay-encoding';
import {
  FTSessionReplay,
  applyPrivacyRegions,
  frameFingerprint,
  type FTCanvasCapture,
  type FTReplayPointerEvent,
  type FTReplayPointerSource,
} from '../src/core/replay';
import { parseTransportResponse, type FTNativeTransport } from '../src/core/transport';
import type { FTAutoTrackingConfig, FTCapturedFrame, FTStoredFrame } from '../src/core/types';

class RecordingTransport implements FTNativeTransport {
  readonly platform = 'android' as const;
  readonly calls: Array<{ method: string; payload: unknown }> = [];

  invoke<T>(method: string, payload?: unknown): T | undefined {
    this.calls.push({ method, payload });
    if (method === 'replay.getContext') {
      return {
        application_id: 'app-id',
        session_id: 'session-id',
        view_id: 'view-id',
      } as T;
    }
    if (method === 'replay.saveImage') return 'resource-id' as T;
    return undefined;
  }
}

class StaticCapture implements FTCanvasCapture {
  disposed = 0;
  readonly rgba = new Uint8Array([
    255, 0, 0, 255,
    0, 255, 0, 255,
    0, 0, 255, 255,
    255, 255, 255, 255,
  ]);

  async capture(): Promise<FTCapturedFrame> {
    return {
      rgba: this.rgba.slice(),
      width: 2,
      height: 2,
      timestamp: 1234,
      privacyRegions: [{ x: 0, y: 0, width: 1, height: 1, mode: 'mask' }],
    };
  }

  async persist(frame: FTCapturedFrame, fingerprint: string): Promise<FTStoredFrame> {
    return { path: '/tmp/frame.rgba', width: frame.width, height: frame.height, timestamp: frame.timestamp, fingerprint };
  }

  disposeStoredFrame(): void {
    this.disposed += 1;
  }

  setPrivacy(): void {}
}

class RecordingAutoTracking implements FTAutoTrackingController {
  readonly starts: Array<{ config: FTAutoTrackingConfig; viewName?: string }> = [];
  stops = 0;

  start(config: FTAutoTrackingConfig, viewName?: string): void {
    this.starts.push({ config, viewName });
  }

  stop(): void {
    this.stops += 1;
  }
}

class RecordingEngineHooks implements FTEngineTrackingHooks {
  sceneChanged: ((name: string) => void) | undefined;
  includeCurrent: boolean | undefined;

  onSceneChanged(callback: (name: string) => void, includeCurrent = true): () => void {
    this.sceneChanged = callback;
    this.includeCurrent = includeCurrent;
    if (includeCurrent) callback('CurrentScene');
    return () => { this.sceneChanged = undefined; };
  }

  onAction(): () => void {
    return () => {};
  }
}

class RecordingPointerSource implements FTReplayPointerSource {
  callback: ((event: FTReplayPointerEvent) => void) | undefined;
  starts = 0;
  stops = 0;

  onReplayPointer(callback: (event: FTReplayPointerEvent) => void): () => void {
    this.starts += 1;
    this.callback = callback;
    return () => {
      this.stops += 1;
      this.callback = undefined;
    };
  }

  emit(event: FTReplayPointerEvent): void {
    this.callback?.(event);
  }
}

describe('core bridge API', () => {
  it('validates SDK endpoint configuration and removes undefined fields', () => {
    const transport = new RecordingTransport();
    const agent = new FTMobileAgent(transport);
    expect(() => agent.start({})).toThrow(/datakitUrl/);

    agent.start({ datakitUrl: 'http://127.0.0.1:9529', debug: undefined });
    expect(transport.calls[transport.calls.length - 1]).toEqual({
      method: 'sdk.configure',
      payload: {
        datakitUrl: 'http://127.0.0.1:9529',
        globalContext: { sdk_package_cocos: '0.1.0-alpha.1' },
      },
    });
  });

  it('rejects sampling rates outside the public 0..1 range', () => {
    const rum = new FTRUM(new RecordingTransport());
    expect(() => rum.start({ androidAppId: 'a', sampleRate: 1.01 })).toThrow(/sampleRate/);
  });

  it('parses success and error envelopes', () => {
    expect(parseTransportResponse<Record<string, string>>('{"ok":true,"value":{"x":"y"}}')).toEqual({ x: 'y' });
    expect(() => parseTransportResponse('{"ok":false,"error":"broken"}')).toThrow('broken');
  });
});

describe('native host hybrid lifecycle', () => {
  it('attaches to the native-owned SDK without sending initialization configuration', () => {
    const transport = new RecordingTransport();
    const autoTracking = new RecordingAutoTracking();
    const sdk = new FTCocosSDK(transport, new StaticCapture(), autoTracking);

    sdk.attach({ autoTrack: { scenes: false, actions: true } });
    sdk.attach({ autoTrack: { scenes: true } });
    sdk.enterCocos({ viewName: 'Game' });
    sdk.enterCocos({ viewName: 'IgnoredDuplicate' });
    sdk.leaveCocos();
    sdk.leaveCocos();

    expect(transport.calls).toEqual([
      {
        method: 'hybrid.attach',
        payload: { requiresReplay: false, sdkVersion: '0.1.0-alpha.1' },
      },
    ]);
    expect(autoTracking.starts).toEqual([
      { config: { scenes: false, actions: true }, viewName: 'Game' },
    ]);
    expect(autoTracking.stops).toBe(1);
  });

  it('keeps the entry view until the next Cocos scene transition', () => {
    const transport = new RecordingTransport();
    const hooks = new RecordingEngineHooks();
    const tracking = new FTDefaultAutoTracking(
      new FTRUM(transport),
      new FTLogger(transport),
      new FTTrace(transport),
      hooks,
      {},
    );

    tracking.start({ scenes: true }, 'InitialCocosView');
    expect(hooks.includeCurrent).toBe(false);
    expect(transport.calls).toEqual([
      { method: 'rum.startView', payload: { name: 'InitialCocosView', attributes: undefined } },
    ]);

    hooks.sceneChanged?.('NextScene');
    tracking.stop();
    expect(transport.calls.slice(1)).toEqual([
      { method: 'rum.stopView', payload: { attributes: undefined } },
      { method: 'rum.startView', payload: { name: 'NextScene', attributes: undefined } },
      { method: 'rum.stopView', payload: { attributes: undefined } },
    ]);
  });

  it('switches the native recorder only while the Cocos page is active', () => {
    const transport = new RecordingTransport();
    const sdk = new FTCocosSDK(transport, new StaticCapture(), new RecordingAutoTracking());

    sdk.attach({
      replay: { captureFps: 2, maxImageDimension: 720 },
      autoTrack: { scenes: true },
    });
    sdk.enterCocos({ viewName: 'Game' });
    sdk.leaveCocos();

    expect(transport.calls.slice(0, 3)).toEqual([
      {
        method: 'hybrid.attach',
        payload: { requiresReplay: true, sdkVersion: '0.1.0-alpha.1' },
      },
      { method: 'hybrid.setExternalRecorderActive', payload: { active: true } },
      { method: 'hybrid.setExternalRecorderActive', payload: { active: false } },
    ]);
  });

  it('keeps standalone initialization and native-host attachment mutually exclusive', () => {
    const standalone = new FTCocosSDK(
      new RecordingTransport(),
      new StaticCapture(),
      new RecordingAutoTracking(),
    );
    standalone.start({ sdk: { datakitUrl: 'http://127.0.0.1:9529' } });
    expect(() => standalone.attach()).toThrow(/mutually exclusive/);

    const hybridTransport = new RecordingTransport();
    const hybrid = new FTCocosSDK(
      hybridTransport,
      new StaticCapture(),
      new RecordingAutoTracking(),
    );
    hybrid.attach({ autoTrack: { scenes: true } });
    expect(() => hybrid.start({ sdk: { datakitUrl: 'http://127.0.0.1:9529' } }))
      .toThrow(/mutually exclusive/);
    expect(() => hybrid.mobile.start({ datakitUrl: 'http://127.0.0.1:9529' }))
      .toThrow(/native host/);
    expect(() => hybrid.rum.start({ androidAppId: 'app-id' })).toThrow(/native host/);
    expect(() => hybrid.logger.start({ enableCustomLog: true })).toThrow(/native host/);
    expect(() => hybrid.trace.start({ traceType: 'ddTrace' })).toThrow(/native host/);
    expect(() => hybrid.replay.start({ captureFps: 1 })).toThrow(/Hybrid Replay/);
    expect(() => hybrid.mobile.shutdown()).toThrow(/native host/);
    expect(() => hybrid.shutdown()).toThrow(/native host/);
    expect(hybridTransport.calls.some((call) => call.method === 'sdk.shutdown')).toBe(false);
  });

  it('requires an explicit initial view when scene tracking is disabled', () => {
    const sdk = new FTCocosSDK(
      new RecordingTransport(),
      new StaticCapture(),
      new RecordingAutoTracking(),
    );
    sdk.attach({ autoTrack: { actions: true } });

    expect(() => sdk.enterCocos()).toThrow(/viewName/);
  });
});

describe('session replay', () => {
  it('masks and hides pixels before persistence', () => {
    const pixels = new Uint8Array(3 * 2 * 4).fill(255);
    applyPrivacyRegions(pixels, 3, 2, [
      { x: 0, y: 0, width: 1, height: 1, mode: 'mask' },
      { x: 1, y: 0, width: 1, height: 1, mode: 'hide' },
    ]);
    expect([...pixels.slice(0, 4)]).toEqual([128, 128, 128, 255]);
    expect([...pixels.slice(4, 8)]).toEqual([0, 0, 0, 255]);
    expect([...pixels.slice(8, 12)]).toEqual([255, 255, 255, 255]);
  });

  it('writes one frame, updates record count, and drops an identical next frame', async () => {
    const transport = new RecordingTransport();
    const capture = new StaticCapture();
    const replay = new FTSessionReplay(transport, capture);

    await expect(replay.captureNow()).resolves.toBe(true);
    await expect(replay.captureNow()).resolves.toBe(false);

    const segmentCall = transport.calls.find((call) => call.method === 'replay.writeSegment');
    const countCall = transport.calls.find((call) => call.method === 'replay.setRecordCount');
    expect(segmentCall).toBeDefined();
    const replaySegment = JSON.parse((segmentCall?.payload as { segment: string }).segment);
    expect(replaySegment.records[2].data.wireframes[0]).not.toHaveProperty('mimeType');
    expect(countCall?.payload).toEqual({ viewId: 'view-id', count: 3 });
    expect(capture.disposed).toBe(1);
    expect(frameFingerprint(capture.rgba)).toMatch(/^10-/);
  });

  it('writes replay pointer interactions even when the next frame is identical', async () => {
    const transport = new RecordingTransport();
    const capture = new StaticCapture();
    const pointers = new RecordingPointerSource();
    const replay = new FTSessionReplay(transport, capture, pointers);

    replay.start({ touchPrivacy: 'show' });
    await expect(replay.captureNow()).resolves.toBe(true);
    pointers.emit({
      eventType: 'down',
      pointerId: 7,
      normalizedX: 0.25,
      normalizedY: 0.75,
      timestamp: 2000,
    });
    pointers.emit({
      eventType: 'up',
      pointerId: 7,
      normalizedX: 0.25,
      normalizedY: 0.75,
      timestamp: 2010,
    });
    await expect(replay.captureNow()).resolves.toBe(true);
    replay.stop();

    const segmentCalls = transport.calls.filter((call) => call.method === 'replay.writeSegment');
    expect(segmentCalls).toHaveLength(2);
    const pointerSegment = JSON.parse((segmentCalls[1]?.payload as { segment: string }).segment);
    expect(pointerSegment.records).toEqual([
      {
        type: 11,
        data: {
          source: 9,
          pointerEventType: 'down',
          pointerType: 'touch',
          pointerId: 7,
          x: 1,
          y: 2,
        },
        timestamp: 2000,
      },
      {
        type: 11,
        data: {
          source: 9,
          pointerEventType: 'up',
          pointerType: 'touch',
          pointerId: 7,
          x: 1,
          y: 2,
        },
        timestamp: 2010,
      },
    ]);
    const countCalls = transport.calls.filter((call) => call.method === 'replay.setRecordCount');
    expect(countCalls[countCalls.length - 1]?.payload).toEqual({ viewId: 'view-id', count: 5 });
    expect(pointers).toMatchObject({ starts: 1, stops: 1 });
  });

  it('keeps touch collection disabled unless touch privacy explicitly allows it', () => {
    const pointers = new RecordingPointerSource();
    const replay = new FTSessionReplay(new RecordingTransport(), new StaticCapture(), pointers);

    replay.start();
    replay.stop();

    expect(pointers).toMatchObject({ starts: 0, stops: 0 });
    expect(() => replay.start({ touchPrivacy: 'invalid' as 'show' })).toThrow(/touchPrivacy/);
  });

  it('encodes the replay envelope expected by native storage', () => {
    const encoded = encodeReplayImageRecord({
      context: { applicationId: 'app', sessionId: 'session', viewId: 'view' },
      resourceId: 'image',
      width: 320,
      height: 180,
      mimeType: 'image/png',
      timestamp: 42,
      contextChanged: true,
      pointerEvents: [{ eventType: 'down', pointerId: 3, x: 80, y: 90, timestamp: 43 }],
    });
    const segment = JSON.parse(encoded.segment);
    expect(encoded.recordCount).toBe(4);
    expect(segment).toMatchObject({ applicationID: 'app', sessionID: 'session', viewID: 'view' });
    expect(segment.records.map((record: { type: number }) => record.type)).toEqual([4, 6, 10, 11]);
    expect(segment.records[2].data.wireframes[0].resourceId).toBe('image');
    expect(segment.records[2].data.wireframes[0].mimeType).toBe('image/png');
    expect(segment.records[3].data).toMatchObject({
      source: 9,
      pointerEventType: 'down',
      pointerType: 'touch',
      pointerId: 3,
      x: 80,
      y: 90,
    });
  });
});
