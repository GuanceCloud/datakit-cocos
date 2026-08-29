# Cocos Creator 2.4 Diagnostic Game

Runnable Creator 2.4.15 project for the diagnostic sample in `../creator2`.

Before opening the project, configure its ignored local environment module from
the repository root:

```bash
export SAMPLE_DATAKIT_URL='https://your-datakit.example.com'
export SAMPLE_ANDROID_APP_ID='your-android-rum-app-id'
export SAMPLE_IOS_APP_ID='your-ios-rum-app-id'
npm run sample:configure
```

For DataWay configuration, use `SAMPLE_DATAWAY_URL` together with
`SAMPLE_CLIENT_TOKEN` instead of `SAMPLE_DATAKIT_URL`. Then open
this directory with Cocos Creator 2.4.15 and preview the startup scene. The UI
runs in web preview; native RUM upload requires an Android or iOS build with the
SDK native bridge installed.
