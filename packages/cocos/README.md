# Guance Cloud SDK Cocos Creator

[![npm package](https://img.shields.io/badge/dynamic/json?label=npm&color=orange&query=$.version&uri=https://static.guance.com/ft-sdk-package/badge/cocos/version.json)](https://www.npmjs.com/package/@cloudcare/cocos-sdk)
[![scope](https://img.shields.io/badge/dynamic/json?label=scope&color=lightgrey&query=$.scope&uri=https://static.guance.com/ft-sdk-package/badge/cocos/info.json)](https://github.com/GuanceCloud/datakit-cocos)
[![Cocos Creator](https://img.shields.io/badge/dynamic/json?label=cocos.creator&color=brightgreen&query=$.cocos_creator&uri=https://static.guance.com/ft-sdk-package/badge/cocos/info.json)](https://github.com/GuanceCloud/datakit-cocos)
[![license](https://img.shields.io/badge/dynamic/json?label=license&color=lightgrey&query=$.license&uri=https://static.guance.com/ft-sdk-package/badge/cocos/info.json)](LICENSE)

## Introduction

Guance Cloud Application Monitoring collects and analyzes RUM, Log, and Trace data from Cocos Creator applications. The SDK supports native Android and iOS builds for Cocos Creator 2.4 and 3.x.

## Supported Scope

| Package entry | Supported Cocos Creator | Native targets |
| --- | --- | --- |
| `@cloudcare/cocos-sdk/creator2` | 2.4.5–2.4.15 | Android API 21+, iOS 12+ |
| `@cloudcare/cocos-sdk/creator3` | 3.6.3–3.8.x | Android API 21+, iOS 12+ |

Cocos Creator 3.0–3.6.2 is supported on a best-effort basis because the stable native build extension API starts at 3.6.3. Web, mini-game, and desktop targets are not currently supported.

## Sampling configuration

Use the percentage-based sampling fields for new integrations. They accept finite values from
`0` to `100`, including decimals such as `0.1` for 0.1%:

```ts
guanceSdk.start({
  sdk: { datakitUrl: 'http://localhost:9529' },
  rum: {
    androidAppId: 'your-app-id',
    iosAppId: 'your-app-id',
    sessionSamplingRate: 20,
    sessionOnErrorSamplingRate: 100,
  },
  logger: { logSamplingRate: 50 },
  trace: { traceSamplingRate: 25 },
});
```

`sessionSamplingRate`, `logSamplingRate`, and `traceSamplingRate` default to 100 in the
native SDK. `sessionOnErrorSamplingRate` defaults to 0. The deprecated `sampleRate` and
`sessionOnErrorSampleRate` fields remain available with their original `0` to `1` unit.
When both forms are supplied for the same setting, the percentage field wins, including
an explicit value of `0`. Fractional percentages require a native SDK with floating-point
sampling support; an older integer-only iOS SDK is rejected instead of rounding the value.

## Optional Session Replay

Session Replay is distributed separately as `@cloudcare/cocos-session-replay`.
Install both packages at the exact same version and run `npx guance-cocos install --replay`.
Compose the SDK with `withSessionReplay` from the matching `/creator2` or `/creator3` entry
before using Replay configuration. Camera selection moves to `sdk.setReplayCamera(camera)`.

Base-only applications continue using this package and its normal initialization API.
Run `npx guance-cocos install --no-replay` and rebuild to remove an existing SDK-managed
Replay native integration. Existing scene component scripts and metadata are preserved.
See the [Replay package guide](https://github.com/GuanceCloud/datakit-cocos/tree/main/packages/cocos-session-replay).

## iOS dependency manager

CocoaPods remains the default. To use Swift Package Manager, add
`cocos-sdk.config.json` to your **Cocos project root** (beside `assets`):

```json
{
  "ios": {
    "dependencyManager": "spm"
  }
}
```

Alternatively, save this setting when installing the extension:

```sh
npx @cloudcare/cocos-sdk install --ios-dependency-manager spm
```

Rebuild the native iOS project in Creator after changing the configuration. The
extension links the local `FTCocosBridge` package and Xcode resolves the pinned
iOS SDK from Git. Fresh SPM projects do not require `pod install`; open the
`.xcodeproj`. If the host uses CocoaPods for other libraries, continue opening
its `.xcworkspace`.

When switching an existing installation, the extension removes its managed SDK
Pod entries and runs `pod install` if Pods were previously installed. Other Pods
are preserved. Manually declared SDK Pods or other Pods that depend on the same
native SDK must be migrated first to avoid duplicate linking. Set the value to
`cocoapods` to switch back, then run `pod install` as usual.

Creator 3 CMake regeneration restores the package integration automatically during
Xcode builds. If you regenerate the project by running CMake separately, rerun
Creator's native build integration before opening Xcode. Hybrid examples use the
same configuration with their existing `native:install` command.

## Examples

[Guance Cloud SDK Cocos Creator Demo](https://github.com/GuanceCloud/datakit-cocos/tree/main/examples)

## Documentation

For installation, configuration, and usage, see the [official documentation](https://docs.guance.com/real-user-monitoring/cocos/app-access/).

## License

Copyright 2020 Changzhou Guance Information Technology Co., Ltd. Licensed under the [Apache License 2.0](LICENSE).
