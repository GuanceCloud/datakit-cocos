import { guanceSdk, setReplayCamera } from '@cloudcare/cocos-sdk/creator3';
import { sampleEnvironment } from './SampleEnvironment.generated';

export function startSdk(camera?: unknown): void {
  if (camera) setReplayCamera(camera);
  guanceSdk.start({
    sdk: {
      ...sampleEnvironment.sdk,
      globalContext: { sample_name: 'diagnostic-game' },
    },
    rum: {
      ...sampleEnvironment.rum,
      sampleRate: 1,
      sessionOnErrorSampleRate: 1,
      enableNativeCrash: true,
      enableNativeAnr: true,
      enableNativeUiBlock: true,
      nativeUiBlockDurationMs: 100,
    },
    logger: { sampleRate: 1, enableCustomLog: true, enableLinkRumData: true },
    trace: { sampleRate: 1, traceType: 'ddTrace', enableLinkRumData: true },
    replay: {
      sampleRate: 1,
      sessionOnErrorSampleRate: 1,
      captureFps: 2,
      maxImageDimension: 720,
      maskInputs: true,
      touchPrivacy: 'show',
    },
    // Network is instrumented manually by the diagnostic scenario so its
    // Action, Resource, Trace, and Error all share the same fault.id.
    autoTrack: { scenes: true, actions: true, errors: true, network: false },
  });
}
