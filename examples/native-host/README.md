# Native host for the Hybrid sample

These files keep SDK ownership in the native host. Run `npm run sample:configure` first, then copy the platform folder into the generated native project.

## Android

Copy both `HybridSampleSdk.java` and the generated `HybridSampleEnvironment.java` to:

```text
app/src/main/java/com/cloudcare/cocos/sample/
```

Call `HybridSampleSdk.start()` before the Cocos JavaScript engine starts. An `Application.onCreate()` call is preferred when the host already has an Application subclass. For a generated empty Cocos project, call it at the beginning of the generated Activity's `onCreate()`.

## iOS

Add `HybridSampleSDK.h`, `HybridSampleSDK.m`, and the generated `HybridSampleEnvironment.generated.h` to the application target. Call `[HybridSampleSDK start]` at the beginning of `application:didFinishLaunchingWithOptions:`, before the launch call is forwarded to Cocos.

The native host starts SDK, RUM, Logger, Trace, and Session Replay. Do not set Session Replay to external-only mode: Cocos `enterCocos()` pauses native view recording, and `leaveCocos()` resumes it.
