# Guance Cloud SDK Cocos Creator

[![npm package](https://img.shields.io/badge/dynamic/json?label=npm&color=orange&query=$.version&uri=https://static.guance.com/ft-sdk-package/badge/cocos/version.json)](https://www.npmjs.com/package/@cloudcare/cocos-sdk)
[![scope](https://img.shields.io/badge/dynamic/json?label=scope&color=lightgrey&query=$.scope&uri=https://static.guance.com/ft-sdk-package/badge/cocos/info.json)](https://github.com/GuanceCloud/datakit-cocos)
[![Cocos Creator](https://img.shields.io/badge/dynamic/json?label=cocos.creator&color=brightgreen&query=$.cocos_creator&uri=https://static.guance.com/ft-sdk-package/badge/cocos/info.json)](https://github.com/GuanceCloud/datakit-cocos)
[![license](https://img.shields.io/badge/dynamic/json?label=license&color=lightgrey&query=$.license&uri=https://static.guance.com/ft-sdk-package/badge/cocos/info.json)](LICENSE)

## Introduction

Guance Cloud Application Monitoring collects and analyzes RUM, Log, Trace, and Session Replay data from Cocos Creator applications. The SDK supports native Android and iOS builds for Cocos Creator 2.4 and 3.x.

## Supported Scope

| Package entry | Supported Cocos Creator | Native targets |
| --- | --- | --- |
| `@cloudcare/cocos-sdk/creator2` | 2.4.5–2.4.15 | Android API 21+, iOS 12+ |
| `@cloudcare/cocos-sdk/creator3` | 3.6.3–3.8.x | Android API 21+, iOS 12+ |

Cocos Creator 3.0–3.6.2 is supported on a best-effort basis because the stable native build extension API starts at 3.6.3. Web, mini-game, and desktop targets are not currently supported.

## Session Replay privacy

Run `npx @cloudcare/cocos-sdk install --project <project-path>` after installing or updating the npm package. The installer adds the matching Creator 2 or Creator 3 script at `assets/guance-cocos-sdk/ReplayPrivacy.ts`.

In Creator, select a node and add **Session Replay > ReplayPrivacy** from the component menu, or drag the script onto the Inspector. Set **Mode** to **Mask** (gray, the default) or **Hide** (black). Save the node in a scene or prefab as usual. This affects captured Replay images only; the live scene stays unchanged. Keep the script's `ReplayPrivacy` class name and its `.meta` file so saved component references remain valid.

The SDK discovers active, enabled components during each capture, including dynamically instantiated prefabs. Disabling or removing the component removes its rule. Creator 3 UI nodes need a `UITransform` to provide capture bounds. Privacy covers a projected rectangular region; it can also cover children and other content within that rectangle. A child cannot expose pixels already covered by a parent's privacy region.

Use the code API for dynamic rules or nodes without a component:

```ts
// Use /creator2 for Creator 2 projects.
import { guanceSdk } from '@cloudcare/cocos-sdk/creator3';

guanceSdk.replay.setPrivacy(node, 'mask');
guanceSdk.replay.setPrivacy(node, 'hide');
guanceSdk.replay.setPrivacy(node, 'unmask'); // Clear the code override.
```

On the same node, code overrides take priority over the component, which takes priority over default `EditBox` masking. `unmask` restores the component/default rule; it does not force sensitive content to become visible. Input fields remain masked by default even when a `ReplayPrivacy` component is disabled. The component's Mode menu therefore offers only Mask and Hide.

## Examples

[Guance Cloud SDK Cocos Creator Demo](https://github.com/GuanceCloud/datakit-cocos/tree/main/examples)

## Documentation

[Documentation Center](https://docs.guance.com/real-user-monitoring/cocos/app-access/)

## License

Copyright 2020 Changzhou Guance Information Technology Co., Ltd. Licensed under the [Apache License 2.0](LICENSE).
