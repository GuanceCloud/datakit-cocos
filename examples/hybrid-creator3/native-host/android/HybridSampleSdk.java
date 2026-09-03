package com.cloudcare.cocos.sample;

import android.app.Activity;

import com.ft.sdk.FTLoggerConfig;
import com.ft.sdk.FTRUMConfig;
import com.ft.sdk.FTSDKConfig;
import com.ft.sdk.FTSdk;
import com.ft.sdk.FTTraceConfig;
import com.ft.sdk.HandlerView;
import com.ft.sdk.TraceType;
import com.ft.sdk.sessionreplay.FTSessionReplayConfig;
import com.ft.sdk.sessionreplay.ImagePrivacy;
import com.ft.sdk.sessionreplay.TextAndInputPrivacy;
import com.ft.sdk.sessionreplay.TouchPrivacy;
import com.cocos.lib.GlobalObject;

import org.json.JSONObject;

import java.lang.reflect.Field;
import java.util.HashMap;

/** Native SDK owner for the Cocos Hybrid sample. Call before Cocos starts JavaScript. */
public final class HybridSampleSdk {
    private static boolean started;

    private HybridSampleSdk() {}

    public static synchronized void start() {
        if (started) return;
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
                .setEnableOkhttpRequestTag(true)
                .addGlobalContext("sample_name", "cocos-hybrid-creator3");
        FTSdk.install(sdkConfig);

        FTSdk.initRUMWithConfig(new FTRUMConfig()
                .setRumAppId(HybridSampleEnvironment.ANDROID_RUM_APP_ID)
                .setSamplingRate(1f)
                .setSessionErrorSampleRate(1f)
                .setEnableTraceUserAction(true)
                .setEnableTraceUserView(true)
                .setEnableTraceUserResource(true)
                .setViewActivityTrackingHandler(activity -> nativeView(activity))
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
                .setEnableAutoTrace(true)
                .setEnableLinkRUMData(true));

        // Keep native recording enabled by default. enterCocos()/leaveCocos() switch
        // recorder ownership between native UI and the Cocos canvas at runtime.
        FTSdk.initSessionReplayConfig(new FTSessionReplayConfig()
                .setSampleRate(1f)
                .setSessionReplayOnErrorSampleRate(1f)
                .setTouchPrivacy(TouchPrivacy.SHOW)
                .setTextAndInputPrivacy(TextAndInputPrivacy.MASK_SENSITIVE_INPUTS)
                .setImagePrivacy(ImagePrivacy.MASK_NONE));
        started = true;
    }

    /** Returns from the generated Cocos Activity to the native landing Activity. */
    public static void returnToNative() {
        Activity activity = GlobalObject.getActivity();
        if (activity != null) activity.runOnUiThread(activity::finish);
    }

    /** Read by the Cocos page before it claims RUM View and Replay ownership. */
    public static boolean isNativePageVisible() {
        return HybridSampleNativeActivity.isVisible();
    }

    /** Returns an optional, generated benchmark bootstrap without adding a production bridge API. */
    public static String replayTrafficBenchmarkConfig() {
        try {
            Class<?> environment = Class.forName(
                    "com.cloudcare.cocos.sample.ReplayTrafficBenchmarkEnvironment");
            Field field = environment.getDeclaredField("CONFIG_JSON");
            field.setAccessible(true);
            Object value = field.get(null);
            return value instanceof String ? (String) value : "{\"enabled\":false}";
        } catch (Exception ignored) {
            return "{\"enabled\":false}";
        }
    }

    /** Adds the unique run markers before the benchmark starts its RUM View. */
    public static void prepareReplayTrafficBenchmark(String json) {
        try {
            JSONObject value = new JSONObject(json);
            HashMap<String, Object> context = new HashMap<>();
            context.put("replay_benchmark_run_id", value.getString("runId"));
            context.put("replay_benchmark_group", value.getString("groupId"));
            context.put("replay_benchmark_scenario", value.getString("scenario"));
            context.put("replay_benchmark_repeat", value.getInt("repeat"));
            FTSdk.appendGlobalContext(context);
        } catch (Exception error) {
            throw new IllegalArgumentException("Invalid Replay Traffic Benchmark config", error);
        }
    }

    /** Requests an immediate native SDK upload after Cocos capture stops. */
    public static void flushReplayTrafficBenchmark() {
        FTSdk.flushSyncData();
    }

    public static boolean isReplayTrafficBenchmarkEnabled() {
        try {
            return new JSONObject(replayTrafficBenchmarkConfig()).optBoolean("enabled", false);
        } catch (Exception ignored) {
            return false;
        }
    }

    private static HandlerView nativeView(Activity activity) {
        if ("com.cocos.game.AppActivity".equals(activity.getClass().getName())) {
            // The Cocos SDK owns this View between enterCocos() and leaveCocos().
            return null;
        }
        if (activity instanceof HybridSampleNativeActivity) {
            return new HandlerView("HybridNativeAndroidHome");
        }
        return new HandlerView(activity.getClass().getSimpleName());
    }
}
