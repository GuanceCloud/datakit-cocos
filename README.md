# Guance Cloud SDK for Cocos Creator

[![npm package](https://img.shields.io/badge/dynamic/json?label=npm&color=orange&query=$.version&uri=https://static.guance.com/ft-sdk-package/badge/cocos/version.json)](https://www.npmjs.com/package/@cloudcare/cocos-sdk)
[![scope](https://img.shields.io/badge/dynamic/json?label=scope&color=lightgrey&query=$.scope&uri=https://static.guance.com/ft-sdk-package/badge/cocos/info.json)](https://github.com/GuanceCloud/datakit-cocos)
[![Cocos Creator](https://img.shields.io/badge/dynamic/json?label=cocos.creator&color=brightgreen&query=$.cocos_creator&uri=https://static.guance.com/ft-sdk-package/badge/cocos/info.json)](https://github.com/GuanceCloud/datakit-cocos)
[![license](https://img.shields.io/badge/dynamic/json?label=license&color=lightgrey&query=$.license&uri=https://static.guance.com/ft-sdk-package/badge/cocos/info.json)](LICENSE)

## Introduction

Guance Cloud Application Monitoring collects and analyzes Log, RUM, Session Replay, and Trace data from Cocos Creator native games while providing a consistent TypeScript API across Cocos Creator 2.4 and 3.x.

This SDK supports native Android and iOS builds. Web, mini-game, and desktop targets are outside its current scope.

## Supported Scope

| Package entry | Supported Cocos Creator | Native targets |
| --- | --- | --- |
| `@cloudcare/cocos-sdk/creator2` | 2.4.5–2.4.15 | Android API 21+, iOS 12+ |
| `@cloudcare/cocos-sdk/creator3` | 3.6.3–3.8.x | Android API 21+, iOS 12+ |

Cocos Creator 3.0–3.6.2 is best effort because the stable native build extension API starts at 3.6.3.

## Example

The [`examples/`](examples/README.md) directory contains diagnostic projects for Cocos Creator 2.4 and 3.x. Sample credentials and endpoints are generated locally from `SAMPLE_*` environment variables and remain ignored by Git.

## Documentation

For installation, initialization, configuration, automatic collection, Session Replay, and native-host Hybrid integration, see the [Cocos Creator SDK documentation](https://docs.guance.com/real-user-monitoring/cocos/app-access/).

## Third-Party Notices

Dependency and third-party licensing information is documented in [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES).

## License

Copyright 2020 Changzhou Guance Information Technology Co., Ltd. Licensed under the [Apache License 2.0](LICENSE).
