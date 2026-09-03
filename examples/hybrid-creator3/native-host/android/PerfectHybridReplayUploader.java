package com.cloudcare.cocos.sample;

import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.ft.sdk.FTRUMGlobalManager;
import com.ft.sdk.FTSdk;
import com.ft.sdk.SessionReplayManager;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.HashMap;
import java.util.Map;

/**
 * Generates one deterministic Native -> Cocos -> Native -> Cocos replay fixture.
 *
 * <p>This intentionally uses the real RUM context and Session Replay storage/upload
 * pipeline. It is a sample-only diagnostic: the Native Views use mobile wireframes
 * while the Cocos Views use rrweb FullSnapshot records, so the console must switch
 * replay formats at every View boundary.</p>
 */
final class PerfectHybridReplayUploader {
    private static final String TAG = "PerfectHybridReplay";
    private static final String OWNER = "perfect-hybrid-replay-fixture";
    private static final String FIXTURE_ID = "perfect-native-cocos-v1";
    private static final long RECORDER_HANDOFF_DELAY_MS = 750L;
    private static final long SECOND_FRAME_DELAY_MS = 1_600L;
    private static final long VIEW_DURATION_MS = 3_200L;
    private static final long VIEW_GAP_MS = 200L;
    private static final long FINAL_UPLOAD_SETTLE_MS = 7_000L;
    private static final int WIDTH = 800;
    private static final int HEIGHT = 420;

    private static final ViewSpec[] VIEWS = new ViewSpec[]{
            new ViewSpec("Perfect Native A", false, "#0c1222ff", "#2ccab2ff"),
            new ViewSpec("Perfect Cocos A", true, "#073b4cff", "#ffd166ff"),
            new ViewSpec("Perfect Native B", false, "#312244ff", "#ff6b6bff"),
            new ViewSpec("Perfect Cocos B", true, "#064e3bff", "#7dd3fcff")
    };

    interface StatusListener {
        void onStatus(String status);
    }

    private static boolean running;
    private static String fixtureSessionId;
    private static long fixtureStartedAt;

    private PerfectHybridReplayUploader() {}

    static synchronized void start(StatusListener listener) {
        if (running) {
            listener.onStatus("Perfect replay upload is already running…");
            return;
        }
        running = true;
        fixtureSessionId = null;
        fixtureStartedAt = System.currentTimeMillis();
        listener.onStatus("Creating perfect Native → Cocos replay data…");

        SessionReplayManager.get().setExternalRecorderActive(OWNER, true);
        new Handler(Looper.getMainLooper()).postDelayed(
                () -> startView(0, listener),
                RECORDER_HANDOFF_DELAY_MS);
    }

    private static void startView(int index, StatusListener listener) {
        if (index >= VIEWS.length) {
            listener.onStatus("All four Views written. Waiting for Replay upload…\nSession: "
                    + fixtureSessionId);
            new Handler(Looper.getMainLooper()).postDelayed(
                    () -> finish(listener),
                    FINAL_UPLOAD_SETTLE_MS);
            return;
        }

        ViewSpec spec = VIEWS[index];
        try {
            HashMap<String, Object> properties = new HashMap<>();
            properties.put("fake_replay_fixture", FIXTURE_ID);
            properties.put("fake_replay_surface", spec.cocos ? "cocos" : "native");
            properties.put("fake_replay_order", index + 1);
            FTRUMGlobalManager.get().startView(spec.name, properties);

            ReplayContext context = currentContext();
            if (fixtureSessionId == null) {
                fixtureSessionId = context.sessionId;
            } else if (!fixtureSessionId.equals(context.sessionId)) {
                throw new IllegalStateException(
                        "RUM session changed while creating fixture: " + context.sessionId);
            }

            long startedAt = System.currentTimeMillis();
            JSONArray records = completeRecords(spec, index, startedAt);
            writeSegment(context, records);
            SessionReplayManager.get().setExternalRecordCount(context.viewId, 5L);
            Log.i(TAG, "PERFECT_HYBRID_VIEW order=" + (index + 1)
                    + " surface=" + (spec.cocos ? "cocos" : "native")
                    + " view_id=" + context.viewId
                    + " records=" + records.length());
            listener.onStatus((index + 1) + "/" + VIEWS.length + " · " + spec.name
                    + "\nSession: " + fixtureSessionId);

            Handler handler = new Handler(Looper.getMainLooper());
            handler.postDelayed(() -> {
                try {
                    FTRUMGlobalManager.get().stopView();
                    handler.postDelayed(() -> startView(index + 1, listener), VIEW_GAP_MS);
                } catch (Exception error) {
                    fail(listener, error);
                }
            }, VIEW_DURATION_MS);
        } catch (Exception error) {
            fail(listener, error);
        }
    }

    private static ReplayContext currentContext() {
        Map<String, Object> context = SessionReplayManager.get().getCurrentExternalRumContext();
        String applicationId = required(context, "application_id");
        String sessionId = required(context, "session_id");
        String viewId = required(context, "view_id");
        return new ReplayContext(applicationId, sessionId, viewId);
    }

    private static String required(Map<String, Object> context, String key) {
        Object value = context == null ? null : context.get(key);
        String text = value == null ? "" : String.valueOf(value);
        if (text.isEmpty() || "null".equalsIgnoreCase(text)) {
            throw new IllegalStateException("Missing RUM context key: " + key);
        }
        return text;
    }

    private static JSONArray completeRecords(ViewSpec spec, int index, long timestamp)
            throws JSONException {
        JSONArray records = new JSONArray();
        JSONObject meta = new JSONObject()
                .put("width", WIDTH)
                .put("height", HEIGHT);
        if (spec.cocos) meta.put("href", "cocos://perfect-fixture/" + (index + 1));
        records.put(event(4, meta, timestamp));
        records.put(event(6, new JSONObject().put("has_focus", true), timestamp));
        records.put(spec.cocos
                ? browserFullSnapshot(spec, index, timestamp, "READY")
                : mobileFullSnapshot(spec, index, timestamp, "READY"));
        records.put(spec.cocos
                ? browserFullSnapshot(spec, index, timestamp + SECOND_FRAME_DELAY_MS, "PLAYING")
                : mobileFullSnapshot(spec, index, timestamp + SECOND_FRAME_DELAY_MS, "PLAYING"));
        records.put(event(7, null, timestamp + VIEW_DURATION_MS));
        return records;
    }

    private static JSONObject mobileFullSnapshot(
            ViewSpec spec,
            int index,
            long timestamp,
            String phase
    ) throws JSONException {
        int idBase = 1_000 + index * 10;
        JSONArray wireframes = new JSONArray()
                .put(shape(idBase + 1, 0, 0, WIDTH, HEIGHT, spec.background))
                .put(shape(idBase + 2, 0, 0, 18, HEIGHT, spec.accent))
                .put(text(idBase + 3, 60, 110, WIDTH - 120, 72, spec.name, "#ffffffff", 38))
                .put(text(
                        idBase + 4,
                        60,
                        205,
                        WIDTH - 120,
                        48,
                        "NATIVE MOBILE SNAPSHOT · " + phase,
                        spec.accent,
                        22))
                .put(text(
                        idBase + 5,
                        60,
                        285,
                        WIDTH - 120,
                        36,
                        "View " + (index + 1) + " / " + VIEWS.length,
                        "#cbd5e1ff",
                        18));
        return event(10, new JSONObject().put("wireframes", wireframes), timestamp);
    }

    private static JSONObject browserFullSnapshot(
            ViewSpec spec,
            int index,
            long timestamp,
            String phase
    ) throws JSONException {
        JSONObject bodyStyle = new JSONObject();
        String css = "margin:0;width:" + WIDTH + "px;height:" + HEIGHT + "px;"
                + "background:" + rgbaToCss(spec.background) + ";color:#fff;"
                + "font-family:sans-serif;display:flex;align-items:center;"
                + "justify-content:center;text-align:center;";

        JSONObject label = element(7, "div", new JSONObject()
                .put("style", "font-size:18px;color:" + rgbaToCss(spec.accent) + ";margin-top:22px;"),
                new JSONArray().put(textNode(8, "COCOS RRWEB SNAPSHOT · " + phase)));
        JSONObject counter = element(9, "div", new JSONObject()
                .put("style", "font-size:16px;color:#cbd5e1;margin-top:22px;"),
                new JSONArray().put(textNode(10, "View " + (index + 1) + " / " + VIEWS.length)));
        JSONObject panel = element(5, "div", new JSONObject()
                        .put("style", "border-left:18px solid " + rgbaToCss(spec.accent)
                                + ";padding:34px 54px;min-width:560px;"),
                new JSONArray()
                        .put(element(6, "div", new JSONObject().put("style", "font-size:38px;"),
                                new JSONArray().put(textNode(11, spec.name))))
                        .put(label)
                        .put(counter));
        JSONObject body = element(4, "body", new JSONObject().put("style", css),
                new JSONArray().put(panel));
        JSONObject html = element(2, "html", bodyStyle,
                new JSONArray()
                        .put(element(3, "head", new JSONObject(), new JSONArray()))
                        .put(body));
        JSONObject document = new JSONObject()
                .put("type", 0)
                .put("id", 1)
                .put("childNodes", new JSONArray()
                        .put(new JSONObject()
                                .put("type", 1)
                                .put("id", 12)
                                .put("name", "html")
                                .put("publicId", "")
                                .put("systemId", ""))
                        .put(html));
        JSONObject data = new JSONObject()
                .put("node", document)
                .put("initialOffset", new JSONObject().put("top", 0).put("left", 0));
        return event(2, data, timestamp);
    }

    private static JSONObject element(
            int id,
            String tagName,
            JSONObject attributes,
            JSONArray children
    ) throws JSONException {
        return new JSONObject()
                .put("type", 2)
                .put("id", id)
                .put("tagName", tagName)
                .put("attributes", attributes)
                .put("childNodes", children);
    }

    private static JSONObject textNode(int id, String value) throws JSONException {
        return new JSONObject()
                .put("type", 3)
                .put("id", id)
                .put("textContent", value);
    }

    private static JSONObject shape(
            int id,
            int x,
            int y,
            int width,
            int height,
            String color
    ) throws JSONException {
        return new JSONObject()
                .put("id", id)
                .put("type", "shape")
                .put("x", x)
                .put("y", y)
                .put("width", width)
                .put("height", height)
                .put("shapeStyle", new JSONObject()
                        .put("backgroundColor", color)
                        .put("opacity", 1.0));
    }

    private static JSONObject text(
            int id,
            int x,
            int y,
            int width,
            int height,
            String value,
            String color,
            int size
    ) throws JSONException {
        return new JSONObject()
                .put("id", id)
                .put("type", "text")
                .put("x", x)
                .put("y", y)
                .put("width", width)
                .put("height", height)
                .put("text", value)
                .put("textStyle", new JSONObject()
                        .put("family", "roboto, sans-serif")
                        .put("size", size)
                        .put("color", color))
                .put("textPosition", new JSONObject()
                        .put("padding", new JSONObject()
                                .put("top", 0)
                                .put("bottom", 0)
                                .put("left", 0)
                                .put("right", 0))
                        .put("alignment", new JSONObject()
                                .put("horizontal", "center")
                                .put("vertical", "center")));
    }

    private static JSONObject event(int type, JSONObject data, long timestamp)
            throws JSONException {
        JSONObject event = new JSONObject()
                .put("type", type)
                .put("timestamp", timestamp);
        if (data != null) event.put("data", data);
        return event;
    }

    private static void writeSegment(ReplayContext context, JSONArray records)
            throws JSONException {
        JSONObject envelope = new JSONObject()
                .put("records", records)
                .put("applicationID", context.applicationId)
                .put("sessionID", context.sessionId)
                .put("viewID", context.viewId);
        SessionReplayManager.get().writeExternalSegment(envelope.toString(), context.viewId);
    }

    private static String rgbaToCss(String rgba) {
        return rgba != null && rgba.length() == 9 ? rgba.substring(0, 7) : rgba;
    }

    private static synchronized void finish(StatusListener listener) {
        HashMap<String, Object> completeProperties = new HashMap<>();
        completeProperties.put("fake_replay_fixture_boundary", "complete");
        FTRUMGlobalManager.get().startView("Perfect Fixture Complete", completeProperties);
        SessionReplayManager.get().setExternalRecorderActive(OWNER, false);
        FTSdk.flushSyncData();
        running = false;
        String marker = "PERFECT_HYBRID_SESSION_ID=" + fixtureSessionId
                + " PERFECT_HYBRID_STARTED_AT=" + fixtureStartedAt;
        Log.i(TAG, marker);
        listener.onStatus("Perfect replay queued for upload.\nSession: " + fixtureSessionId
                + "\nNative → Cocos → Native → Cocos");
    }

    private static synchronized void fail(StatusListener listener, Exception error) {
        try {
            FTRUMGlobalManager.get().stopView();
        } catch (Exception ignored) {
            // Best-effort cleanup for this sample-only diagnostic.
        }
        SessionReplayManager.get().setExternalRecorderActive(OWNER, false);
        running = false;
        Log.e(TAG, "Perfect hybrid replay fixture failed", error);
        listener.onStatus("Perfect replay failed: " + error.getMessage());
    }

    private static final class ReplayContext {
        final String applicationId;
        final String sessionId;
        final String viewId;

        ReplayContext(String applicationId, String sessionId, String viewId) {
            this.applicationId = applicationId;
            this.sessionId = sessionId;
            this.viewId = viewId;
        }
    }

    private static final class ViewSpec {
        final String name;
        final boolean cocos;
        final String background;
        final String accent;

        ViewSpec(String name, boolean cocos, String background, String accent) {
            this.name = name;
            this.cocos = cocos;
            this.background = background;
            this.accent = accent;
        }
    }
}
