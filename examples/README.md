# Diagnostic game sample

The diagnostic sample is a small, art-asset-free game flow for validating Cocos RUM and Session Replay on a native build. Both Creator 2.4 and Creator 3.x versions create real `LoginScene`, `LobbyScene`, `BattleScene`, and `ResultScene` instances at runtime.

## Run it

1. Configure the Sample from environment variables in the repository root:

   ```bash
   export SAMPLE_DATAKIT_URL='https://your-datakit.example.com'
   export SAMPLE_ANDROID_APP_ID='your-android-rum-app-id'
   export SAMPLE_IOS_APP_ID='your-ios-rum-app-id'
   npm run sample:configure
   ```

   For DataWay, omit `SAMPLE_DATAKIT_URL` and set both
   `SAMPLE_DATAWAY_URL` and `SAMPLE_CLIENT_TOKEN`. At least one
   platform app ID is required. Optional variables are
   `SAMPLE_SERVICE_NAME`, `SAMPLE_ENV`, and `SAMPLE_DEBUG=true|false`.
2. Install the matching SDK package and native bridge in a Cocos project.
3. Copy `shared/` and either `creator2/` or `creator3/` into the project's `assets/` directory while preserving their relative layout.
4. Create one empty startup scene and attach `DiagnosticSample` to any node.
5. Build and run on Android or iOS. The editor/browser preview can render the flow, but the native build is required to upload telemetry and Replay data.

`sample:configure` writes ignored `SampleEnvironment.generated.ts` files and never prints their values. Do not copy those values into `SdkBootstrap.ts` or force-add a generated file to Git.

Leave `autoStartSdk` enabled for the standalone sample. Disable it when the host application starts `guanceSdk` before the sample component. The sample switches the Replay camera whenever it creates a scene. Its bootstrap leaves automatic network tracking off because the controlled network failure is manually instrumented with one shared `fault.id`; enabling both paths would intentionally produce duplicate network events.

## Coverage

| Sample interaction | Observable data |
| --- | --- |
| Login, role selection, logout | bound user, Action, Log, masked `EditBox` replay region, Replay touch down/up interactions |
| Lobby and three levels | real scene/View changes, level and role attributes |
| Move, attack, complete | automatic button Action plus enriched game Action |
| Player and boss animation | `game.animation`, score/HP/position, visible Replay frames |
| Initial level load | a real Cocos `resources.load` of `diagnostic-level.json`, with Resource timing and game-state attributes |
| Resource 404 | a real failed Cocos `resources.load`, failed Resource, Error, before/after Log, and missing-character visual state |
| Network failure | a real request to the reserved `.invalid` domain, Trace headers, Resource, Error, and before/after network state |
| Business logic error | Error with before/after HP, action, scene, level, and animation |
| Rendering error | Error plus a visible corrupted player frame in Replay |
| Device compatibility error | a real GPU maximum-texture-size capability check plus platform, OS, renderer, and vendor attributes |
| Main-thread stall | a controlled ~320 ms visual freeze, LongTask, and linked Log |
| Every third attack | deterministic intermittent race scenario with attempt and input sequence |

All fault events receive a stable `fault.id`. Search that value across Error and Log data, then inspect the containing Session, View, Action, Resource, performance data, and Replay timeline. Native RUM fields provide the app version, device, and operating system dimensions for comparisons between releases and environments.
