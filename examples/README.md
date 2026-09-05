# Hybrid diagnostic game sample

## Complete local-SDK projects

Two independent, directly openable projects are available for checking the
Hybrid integration documentation against a minimal implementation:

- `hybrid-creator3/` — Cocos Creator 3.8.8
- `hybrid-creator2/` — Cocos Creator 2.4.15

Each project installs `@cloudcare/cocos-sdk` through
`file:../../packages/cocos`, has an ignored per-project native environment,
initializes RUM/Log/Trace/Replay in Android and iOS, and provides four buttons
that create deterministic validation data. Start with the README inside the
matching directory. The larger diagnostic game described below remains useful
for multi-scene and fault-scenario coverage.

The diagnostic sample is a small, art-asset-free Hybrid integration for validating Cocos RUM and Session Replay inside a native host. The native host owns Guance SDK initialization; Cocos attaches instrumentation only while the app is inside the Cocos runtime. Both Creator 2.4 and Creator 3.x versions create real `LoginScene`, `LobbyScene`, `BattleScene`, and `ResultScene` instances at runtime.

## Run it

1. Configure the native host from environment variables in the repository root:

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
2. Install the matching Cocos SDK package and native bridge in a Cocos project.
3. Copy `shared/` and either `creator2/` or `creator3/` into the project's `assets/` directory while preserving their relative layout.
4. Copy the matching files from `native-host/` into the generated native project. Keep Android files in the `com.cloudcare.cocos.sample` package, or update both package declarations together.
5. Start the native SDK before Cocos starts JavaScript:

   - Android: call `HybridSampleSdk.start()` from `Application.onCreate()` or at the beginning of the generated Activity's `onCreate()`.
   - iOS: call `[HybridSampleSDK start]` at the beginning of `application:didFinishLaunchingWithOptions:`, before forwarding launch to the Cocos app delegate.

6. Create one empty startup scene and attach `DiagnosticSample` to any node. Leave `autoEnterCocos` enabled.
7. Build and run on Android or iOS. Hybrid attachment intentionally requires a native build; editor/browser preview has no native SDK instance to attach to.

`sample:configure` writes ignored Android and iOS native environment files and never prints their values. Do not move the endpoint, token, or RUM App IDs into `SdkBootstrap.ts`, and do not force-add generated environment files to Git.

`SdkBootstrap.ts` calls `guanceSdk.attach()` followed by `guanceSdk.enterCocos()`. When the host really leaves or removes the Cocos container, call the exported `leaveCocos()` before teardown so native Session Replay resumes ownership. Do not call it for Cocos scene changes or from `DiagnosticSample.onDestroy()`: the startup component is destroyed when the sample creates its first runtime scene, while the app is still inside Cocos.

The diagnostic sample binds only synthetic identity data: `cocos-demo-001`, a
`Fake Cocos ... Player` display name, and an address under the reserved
`example.test` domain. Keep real user identities out of sample and benchmark
runs.

The sample switches the Replay camera whenever it creates a scene. Its bootstrap leaves automatic network tracking off because the controlled network failure is manually instrumented with one shared `fault.id`; enabling both paths would intentionally produce duplicate network events.

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
