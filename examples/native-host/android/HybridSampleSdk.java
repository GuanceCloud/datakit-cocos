package com.cloudcare.cocos.sample;

import com.ft.sdk.FTLoggerConfig;
import com.ft.sdk.FTRUMConfig;
import com.ft.sdk.FTSDKConfig;
import com.ft.sdk.FTSdk;
import com.ft.sdk.FTTraceConfig;
import com.ft.sdk.TraceType;
import com.ft.sdk.sessionreplay.FTSessionReplayConfig;
import com.ft.sdk.sessionreplay.ImagePrivacy;
import com.ft.sdk.sessionreplay.TextAndInputPrivacy;
import com.ft.sdk.sessionreplay.TouchPrivacy;

/** Native SDK owner for the Cocos Hybrid sample. Call before Cocos starts JavaScript. */
public final class HybridSampleSdk {
    private HybridSampleSdk() {}

    public static void start() {
        if (FTSdk.get() != null) return;
        if (HybridSampleEnvironment.ANDROID_RUM_APP_ID == null) {
            throw new IllegalStateException("Set SAMPLE_ANDROID_APP_ID before building the Android sample");
        }

        FTSDKConfig sdkConfig = HybridSampleEnvironment.DATAKIT_URL != null
                ? FTSDKConfig.builder(HybridSampleEnvironment.DATAKIT_URL)
                : FTSDKConfig.builder(
                        HybridSampleEnvironment.DATAWAY_URL,
                        HybridSampleEnvironment.CLIENT_TOKEN);
        sdkConfig
                .setDebug(HybridSampleEnvironment.DEBUG)
                .setServiceName(HybridSampleEnvironment.SERVICE_NAME)
                .setEnv(HybridSampleEnvironment.ENV)
                .addGlobalContext("sample_name", "diagnostic-game");
        FTSdk.install(sdkConfig);

        FTSdk.initRUMWithConfig(new FTRUMConfig()
                .setRumAppId(HybridSampleEnvironment.ANDROID_RUM_APP_ID)
                .setSamplingRate(1f)
                .setSessionErrorSampleRate(1f)
                .setEnableTraceUserAction(true)
                .setEnableTraceUserView(true)
                .setEnableTraceUserResource(true)
                .setEnableTrackAppANR(true)
                .setEnableTrackAppCrash(true)
                .setEnableTrackAppUIBlock(true, 100));
        FTSdk.initLogWithConfig(new FTLoggerConfig()
                .setSamplingRate(1f)
                .setEnableCustomLog(true)
                .setEnableLinkRumData(true)
                .setPrintCustomLogToConsole(true));
        FTSdk.initTraceWithConfig(new FTTraceConfig()
                .setSamplingRate(1f)
                .setTraceType(TraceType.DDTRACE)
                .setEnableLinkRUMData(true));

        // Keep native recording enabled by default. enterCocos()/leaveCocos() switch
        // recorder ownership between native UI and the Cocos canvas at runtime.
        FTSdk.initSessionReplayConfig(new FTSessionReplayConfig()
                .setSampleRate(1f)
                .setSessionReplayOnErrorSampleRate(1f)
                .setTouchPrivacy(TouchPrivacy.SHOW)
                .setTextAndInputPrivacy(TextAndInputPrivacy.MASK_SENSITIVE_INPUTS)
                .setImagePrivacy(ImagePrivacy.MASK_NONE));
    }
}
