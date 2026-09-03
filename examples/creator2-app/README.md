# Cocos Creator 2.4 Hybrid Diagnostic Game

Runnable Creator 2.4.15 project for the diagnostic sample in `../creator2`.

Before opening the project, configure the ignored native-host environment files
from the repository root:

```bash
export SAMPLE_DATAKIT_URL='https://your-datakit.example.com'
export SAMPLE_ANDROID_APP_ID='your-android-rum-app-id'
export SAMPLE_IOS_APP_ID='your-ios-rum-app-id'
npm run sample:configure
```

For DataWay configuration, use `SAMPLE_DATAWAY_URL` together with
`SAMPLE_CLIENT_TOKEN` instead of `SAMPLE_DATAKIT_URL`. Then install the SDK
native bridge, build Android or iOS, copy the matching files from
`../native-host/` into the generated project, and call its `start` entry point
before Cocos starts JavaScript. The sample uses `attach()` and `enterCocos()`;
browser preview is therefore not a valid Hybrid integration target.

See [`../README.md`](../README.md) for the complete native lifecycle and the
required `leaveCocos()` boundary.
