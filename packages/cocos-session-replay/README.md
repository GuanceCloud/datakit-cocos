# Guance Cocos Session Replay

Optional Session Replay for native Android and iOS applications built with Cocos Creator 2.4 and 3.x. Install the exact same version of `@cloudcare/cocos-sdk` and `@cloudcare/cocos-session-replay`.

```sh
npm install @cloudcare/cocos-sdk@<version> @cloudcare/cocos-session-replay@<version>
npx guance-cocos install --replay
```

Reopen Creator and rebuild the native project. Use `--creator 2` or `--creator 3` if automatic detection is unavailable. Add `--ios-dependency-manager spm` to select Swift Package Manager; CocoaPods remains the default.

## Standalone application

```ts
import { guanceSdk as baseSdk } from '@cloudcare/cocos-sdk/creator3';
import { withSessionReplay } from '@cloudcare/cocos-session-replay/creator3';

export const sdk = withSessionReplay(baseSdk);
sdk.start({
  sdk: { datakitUrl: 'http://localhost:9529' },
  rum: { androidAppId: 'your-app-id', iosAppId: 'your-app-id' },
  replay: { captureFps: 1, touchPrivacy: 'hide' },
});
```

For Creator 2, use the `/creator2` entry from both packages. Compose before starting or attaching the base SDK. `sdk.setReplayCamera(camera)` selects the capture camera; `sdk.replay.setPrivacy(node, 'mask')` protects a node. The installer places `ReplayPrivacy.ts` under `assets/guance-cocos-sdk` for scene/prefab use.

## Hybrid application

The native host owns SDK/RUM/Replay initialization and sampling. Attach the composed SDK to that instance:

```ts
sdk.attach({ replay: { captureFps: 1 }, autoTrack: { scenes: true } });
sdk.enterCocos();
// When returning to the native host:
sdk.leaveCocos();
```

If automatic scene tracking is disabled, pass a `viewName` to `enterCocos`. Use `leaveCocos` instead of `shutdown` in Hybrid mode. Replay uses the native host's existing RUM session, image storage, and uploader.

## Migration from the combined package

Add this package and compose the existing SDK with `withSessionReplay`. Move the old `setReplayCamera(camera)` call to `sdk.setReplayCamera(camera)`. Import Replay configuration types from this package. Existing `start({ replay })`, `attach({ replay })`, and `sdk.replay` operations are available on the composed SDK.

The base package alone does not accept Replay configuration. Missing or incompatible native Replay integration reports an error when enabling Replay, with instructions to rerun installation and rebuild.

Run `npx guance-cocos install --no-replay` and rebuild to remove SDK-managed native Replay integration. Existing ReplayPrivacy scripts and their `.meta` identifiers are preserved because scenes may reference them. Native Replay independently used by a Hybrid host must remain installed by that host.

## Native dependencies

This package carries the optional Replay bridge, asynchronous image workers, C++ frame-file bindings, and privacy components. Its integration descriptor adds Android `ft-session-replay`, or iOS `GuanceSDK/FTSessionReplay` / `GuanceSessionReplay`. Base SDK dependencies are shared rather than duplicated.

Licensed under Apache-2.0; see `LICENSE` and `THIRD_PARTY_NOTICES`.
