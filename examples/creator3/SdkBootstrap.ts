import { guanceSdk, setReplayCamera } from '@cloudcare/cocos-sdk/creator3';

/** Attach Cocos instrumentation to the SDK instance initialized by the native host. */
export function enterCocos(camera?: unknown): void {
  if (camera) setReplayCamera(camera);
  guanceSdk.attach({
    replay: {
      captureFps: 2,
      maxImageDimension: 720,
      touchPrivacy: 'show',
    },
    // Network is instrumented manually by the diagnostic scenario so its
    // Action, Resource, Trace, and Error all share the same fault.id.
    autoTrack: { scenes: true, actions: true, errors: true, network: false },
  });
  guanceSdk.enterCocos();
}

/** Release Cocos instrumentation while leaving the native Cocos container. */
export function leaveCocos(): void {
  guanceSdk.leaveCocos();
}
