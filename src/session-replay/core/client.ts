import type { FTCocosSDK, FTNativeTransport, FTCocosEnterOptions } from '@cloudcare/cocos-sdk/plugin-api';
import { FTSessionReplay, type FTCanvasCapture, type FTReplayPointerSource } from './replay.js';
import type { FTCocosReplayConfig, FTCocosHybridReplayConfig, FTSessionReplayConfig, FTHybridSessionReplayConfig } from './types.js';
import { FT_COCOS_REPLAY_VERSION } from './version.js';
import { replayImagePolicy, captureFps, samplingRate } from './validation.js';

export interface FTReplayCapture extends FTCanvasCapture { setCamera(camera: unknown): void; }

/** Typed Replay facade; the supplied base SDK continues to own lifecycle state. */
export class FTCocosReplaySDK {
  readonly mobile: FTCocosSDK['mobile'];
  readonly rum: FTCocosSDK['rum'];
  readonly logger: FTCocosSDK['logger'];
  readonly trace: FTCocosSDK['trace'];

  constructor(
    private readonly base: FTCocosSDK,
    readonly replay: FTSessionReplay,
    private readonly capture: FTReplayCapture,
    private readonly configure: (config: FTSessionReplayConfig | undefined) => void,
  ) {
    this.mobile = base.mobile;
    this.rum = base.rum;
    this.logger = base.logger;
    this.trace = base.trace;
  }

  start(config: FTCocosReplayConfig): void {
    const { replay, ...base } = config;
    this.configure(replay);
    try { this.base.start(base); } finally { this.configure(undefined); }
  }

  attach(config: FTCocosHybridReplayConfig = {}): void {
    const { replay, ...base } = config;
    this.configure(replay);
    try { this.base.attach(base); } finally { this.configure(undefined); }
  }

  setReplayCamera(camera: unknown): void { this.capture.setCamera(camera); }
  enterCocos(options?: FTCocosEnterOptions): void { this.base.enterCocos(options); }
  leaveCocos(): void { this.base.leaveCocos(); }
  shutdown(): void { this.base.shutdown(); }
}

export function composeSessionReplay(
  base: FTCocosSDK,
  engine: 'creator2' | 'creator3',
  create: () => { transport: FTNativeTransport; capture: FTReplayCapture; pointers: FTReplayPointerSource },
): FTCocosReplaySDK {
  if (!base || base.extensionProtocol !== 1 || typeof base.registerExtension !== 'function') {
    throw new Error('Upgrade @cloudcare/cocos-sdk to the matching Session Replay package version');
  }
  return base.registerExtension('session-replay', FT_COCOS_REPLAY_VERSION, engine, () => {
    const { transport, capture, pointers } = create();
    const replay = new FTSessionReplay(transport, capture, pointers, () => validateNativeReplay(transport, false));
    let pending: FTSessionReplayConfig | undefined;
    const facade = new FTCocosReplaySDK(base, replay, capture, config => { pending = config; });
    return {
      value: facade,
      lifecycle: {
        beforeStart: () => {
          if (pending === undefined) return;
          validateConfig(pending);
          samplingRate(pending.sampleRate, 'replay.sampleRate');
          samplingRate(pending.sessionOnErrorSampleRate, 'replay.sessionOnErrorSampleRate');
          validateNativeReplay(transport, false);
        },
        afterStart: () => { if (pending !== undefined) replay.start(pending); },
        beforeAttach: () => {
          if (pending !== undefined) {
            validateConfig(pending);
            validateNativeReplay(transport, true);
          }
          replay.attachHybrid(pending);
        },
        rollbackAttach: () => replay.detachHybrid(),
        enter: () => replay.enterHybrid(),
        leave: () => replay.leaveHybrid(),
        shutdown: () => replay.stop(),
      },
    };
  });
}

function validateConfig(config: FTHybridSessionReplayConfig): void {
  captureFps(config.captureFps);
  replayImagePolicy(config);
  if (config.touchPrivacy !== undefined && config.touchPrivacy !== 'hide' && config.touchPrivacy !== 'show') {
    throw new TypeError("touchPrivacy must be either 'show' or 'hide'");
  }
}

function validateNativeReplay(transport: FTNativeTransport, hybrid: boolean): void {
  if (transport.platform === 'unsupported') return;
  try {
    const result = transport.invoke<{ protocol: number }>('replay.capabilities', { hybrid });
    if (result?.protocol !== 1) throw new Error('Native Replay bridge protocol does not match');
  } catch (error) {
    throw new Error(`Session Replay native integration is unavailable. Run the SDK installer with --replay and rebuild the native application. ${String(error)}`);
  }
}
