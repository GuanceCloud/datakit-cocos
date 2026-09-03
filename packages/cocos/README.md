# @cloudcare/cocos-sdk

[![npm package](https://img.shields.io/badge/dynamic/json?label=npm&color=orange&query=$.version&uri=https://static.guance.com/ft-sdk-package/badge/cocos/version.json)](https://www.npmjs.com/package/@cloudcare/cocos-sdk)
[![scope](https://img.shields.io/badge/dynamic/json?label=scope&color=lightgrey&query=$.scope&uri=https://static.guance.com/ft-sdk-package/badge/cocos/info.json)](https://github.com/GuanceCloud/datakit-cocos)
[![Cocos Creator](https://img.shields.io/badge/dynamic/json?label=cocos.creator&color=brightgreen&query=$.cocos_creator&uri=https://static.guance.com/ft-sdk-package/badge/cocos/info.json)](https://github.com/GuanceCloud/datakit-cocos)
[![license](https://img.shields.io/badge/dynamic/json?label=license&color=lightgrey&query=$.license&uri=https://static.guance.com/ft-sdk-package/badge/cocos/info.json)](LICENSE)

## Introduction

Guance Cloud Application Monitoring collects and analyzes Log, RUM, Session Replay, and Trace data from Cocos Creator native games. The package provides separate entry points for Cocos Creator 2.4 and 3.x while keeping their TypeScript APIs consistent.

This SDK supports native Android and iOS builds. Web, mini-game, and desktop targets are outside its current scope.

## Supported Scope

| Package entry | Supported Cocos Creator | Native targets |
| --- | --- | --- |
| `@cloudcare/cocos-sdk/creator2` | 2.4.5–2.4.15 | Android API 21+, iOS 12+ |
| `@cloudcare/cocos-sdk/creator3` | 3.6.3–3.8.x | Android API 21+, iOS 12+ |

Cocos Creator 3.0–3.6.2 is best effort because the stable native build extension API starts at 3.6.3.

## Quick Start

Install the package from the root of an existing Cocos Creator project, then copy the matching build extension into the project:

```bash
npm install @cloudcare/cocos-sdk
npx @cloudcare/cocos-sdk install --project .
```

Re-open Cocos Creator, enable the `guance-cocos-sdk` extension, and initialize the SDK once from an early component. Use the `creator2` entry instead when building with Cocos Creator 2.4.

```ts
import { guanceSdk } from '@cloudcare/cocos-sdk/creator3';

guanceSdk.start({
  sdk: {
    datawayUrl: 'https://your-dataway.example.com',
    clientToken: 'YOUR_CLIENT_TOKEN',
    serviceName: 'your-cocos-game',
    env: 'prod',
  },
  rum: {
    androidAppId: 'YOUR_ANDROID_RUM_APP_ID',
    iosAppId: 'YOUR_IOS_RUM_APP_ID',
    sampleRate: 1,
    enableNativeCrash: true,
    enableNativeAnr: true,
  },
  logger: {
    sampleRate: 1,
    enableCustomLog: true,
    enableLinkRumData: true,
  },
  trace: {
    sampleRate: 1,
    traceType: 'ddTrace',
    enableLinkRumData: true,
  },
});
```

Keep `clientToken` outside source control. For local DataKit reporting, configure `datakitUrl` instead of `datawayUrl` and `clientToken`.

Build the Android or iOS native project from Cocos Creator after installing the extension. Android dependencies and bridge sources are injected during the native build. On iOS, run `pod install` in the generated Xcode project directory and open the generated `.xcworkspace`.

Before building, configure the native toolchains required by your Creator version. For Cocos Creator 3.8, see the official [native development environment guide](https://docs.cocos.com/creator/3.8/manual/en/editor/publish/setup-native-development.html).

## Documentation

The exported TypeScript declarations document all configuration and collection APIs. A native-host Hybrid diagnostic sample covering automatic collection and Session Replay is available in the [GitHub repository](https://github.com/GuanceCloud/datakit-cocos/tree/main/examples).

## Example

Diagnostic projects for both supported Creator generations are available in the [GitHub repository](https://github.com/GuanceCloud/datakit-cocos/tree/main/examples).

## Third-Party Notices

See [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES) for third-party attribution.

## License

Copyright 2020 Changzhou Guance Information Technology Co., Ltd. Licensed under the [Apache License 2.0](LICENSE).
