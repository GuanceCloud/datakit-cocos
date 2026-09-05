import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildReplayTrafficRunConfig,
  REPLAY_TRAFFIC_GROUPS,
} from '../scripts/replay-traffic-benchmark-config.mjs';
import { resolveNativeSdkRoot } from '../scripts/replay-traffic-local-config.mjs';
import { createReplayTrafficCaptureServer } from '../scripts/replay-traffic-capture-server.mjs';
import {
  analyzeReplayTrafficRun,
  aggregateReplayTrafficRuns,
} from '../scripts/report-replay-traffic-benchmark.mjs';
import { emitReplayDiagnostic, replayUtf8ByteLength } from '../src/core/replay-diagnostics.js';

describe('Replay Traffic Benchmark configuration', () => {
  it('keeps native SDK locations in local environment configuration', () => {
    expect(resolveNativeSdkRoot({
      platform: 'android',
      workspaceRoot: '/workspace/ft-sdk-cocos',
      environment: { REPLAY_TRAFFIC_ANDROID_SDK_ROOT: '../native/android-sdk' },
    })).toBe('/workspace/native/android-sdk');
    expect(resolveNativeSdkRoot({
      platform: 'ios',
      workspaceRoot: '/workspace/ft-sdk-cocos',
      optionValue: '/opt/sdk/ios',
      environment: { REPLAY_TRAFFIC_IOS_SDK_ROOT: '/ignored' },
    })).toBe('/opt/sdk/ios');
    expect(resolveNativeSdkRoot({
      platform: 'ios',
      workspaceRoot: '/workspace/ft-sdk-cocos',
      environment: {},
    })).toBe('/workspace/ft-sdk-ios');
  });

  it('expands all image and pointer groups deterministically', () => {
    expect(Object.keys(REPLAY_TRAFFIC_GROUPS)).toHaveLength(12);
    const config = buildReplayTrafficRunConfig({
      runId: 'android-reference-med2-full-r01-20260903T120000Z',
      platform: 'android',
      deviceLabel: 'android-reference',
      groupId: 'MED-2-768K',
      scenario: 'FULL-MOTION',
      repeat: 1,
    });
    expect(config.replay).toMatchObject({
      captureFps: 2,
      imagePolicy: { maxBytesPerMinute: 786_432, maxFrameBytes: 40_960 },
      touchPrivacy: 'hide',
    });
    expect(config.measurementMs).toBe(130_000);
  });

  it('rejects matrix combinations that would make unlike runs comparable', () => {
    expect(() => buildReplayTrafficRunConfig({
      runId: 'ios-reference-med5-static-r01',
      platform: 'ios',
      deviceLabel: 'ios-reference',
      groupId: 'MED-5',
      scenario: 'STATIC',
      repeat: 1,
    })).toThrow(/not in the STATIC matrix/);
    expect(() => buildReplayTrafficRunConfig({
      runId: 'ios-reference-ptr-motion-r01',
      platform: 'ios',
      deviceLabel: 'ios-reference',
      groupId: 'PTR-SHOW-10',
      scenario: 'FULL-MOTION',
      repeat: 1,
    })).toThrow(/must use STATIC/);
  });
});

describe('Replay diagnostic observer', () => {
  afterEach(() => {
    delete (globalThis as typeof globalThis & { __FT_COCOS_REPLAY_BENCHMARK_OBSERVER__?: unknown })
      .__FT_COCOS_REPLAY_BENCHMARK_OBSERVER__;
  });

  it('is a no-op by default and cannot break capture when an observer throws', () => {
    expect(() => emitReplayDiagnostic({ type: 'replay_stopped', timestamp: 1 })).not.toThrow();
    (globalThis as typeof globalThis & { __FT_COCOS_REPLAY_BENCHMARK_OBSERVER__?: () => void })
      .__FT_COCOS_REPLAY_BENCHMARK_OBSERVER__ = () => { throw new Error('observer failure'); };
    expect(() => emitReplayDiagnostic({ type: 'replay_stopped', timestamp: 2 })).not.toThrow();
  });

  it('counts UTF-8 segment bytes without depending on TextEncoder', () => {
    expect(replayUtf8ByteLength('ascii')).toBe(5);
    expect(replayUtf8ByteLength('回放🙂')).toBe(Buffer.byteLength('回放🙂'));
  });
});

describe('Replay Traffic capture server', () => {
  it('returns Datakit-compatible asset checks and persists only numeric HTTP statistics', async () => {
    const resultsRoot = await mkdtemp(path.join(tmpdir(), 'replay-traffic-test-'));
    const server = createReplayTrafficCaptureServer({
      host: '127.0.0.1',
      dataPort: 0,
      controlPort: 0,
      resultsRoot,
    });
    const address = await server.listen();
    const control = `http://127.0.0.1:${address.controlPort}`;
    const data = `http://127.0.0.1:${address.dataPort}`;
    const config = buildReplayTrafficRunConfig({
      runId: 'android-server-test-med2-full-r01',
      platform: 'android',
      deviceLabel: 'android-test',
      groupId: 'MED-2',
      scenario: 'FULL-MOTION',
      repeat: 1,
      measurementSeconds: 1,
    });
    try {
      await jsonRequest(`${control}/config`, 'PUT', config);
      await jsonRequest(`${data}/v1/write/rum/replay`, 'POST', { prewarm: true });
      const configured = await jsonRequest(`${control}/status`, 'GET');
      expect(configured.state).toBe('configured');
      expect(configured.lastDataAt).toEqual(expect.any(Number));
      expect(configured.quietForMs).toEqual(expect.any(Number));
      expect(configured.bodyBytes).toBeGreaterThan(0);
      expect(configured.requestCount).toBe(1);
      await jsonRequest(`${control}/runs/start`, 'POST', { runId: config.runId });
      const check = await jsonRequest(`${data}/v1/check/rum/replay_assets`, 'POST', {
        app_id: 'local-test',
        files: ['resource-a.webp', 'resource-b.webp'],
      });
      expect(check.content).toEqual({ 'resource-a.webp': false, 'resource-b.webp': false });
      await jsonRequest(`${data}/v1/write/rum/replay`, 'POST', { segment: 'synthetic' });
      await jsonRequest(`${data}/v1/write/rum/replay`, 'POST', { segment: 'synthetic' });
      await jsonRequest(`${data}/v1/datakit/pull`, 'POST');
      await jsonRequest(`${data}/v1/datakit/pull`, 'POST');
      await multipartRequest(`${data}/v1/write/rum/replay_assets`, {
        filename: 'private-resource-name.webp',
        payload: Buffer.from('private-resource-payload'),
      });
      await jsonRequest(`${control}/runs/${config.runId}/events`, 'POST', {
        events: [{ type: 'image_saved', timestamp: Date.now(), byteSize: 1024 }],
      });
      const stopped = await jsonRequest(`${control}/runs/${config.runId}/stop`, 'POST', {});
      const httpSource = await readFile(path.join(stopped.resultDirectory, 'http.json'), 'utf8');
      const httpStats = JSON.parse(httpSource);
      expect(httpStats.requestCount).toBe(6);
      expect(httpStats.retryCount).toBe(1);
      expect(httpStats.bodyBytes).toBeGreaterThan(0);
      expect(httpStats.connectionBytes).toBeGreaterThan(httpStats.bodyBytes);
      expect(httpSource).not.toContain('synthetic');
      expect(httpSource).not.toContain('local-test');
      expect(httpSource).not.toContain('private-resource-name');
      expect(httpSource).not.toContain('private-resource-payload');
      expect(httpStats.requests.at(-1)).toMatchObject({
        multipartFileCount: 1,
        multipartFileBytes: Buffer.byteLength('private-resource-payload'),
        multipartFieldCount: 1,
      });
    } finally {
      await server.close();
    }
  });
});

describe('Replay Traffic report', () => {
  it('calculates rolling image budgets, overhead, and repetition variability', () => {
    const run = analyzeReplayTrafficRun({
      metadata: {
        runId: 'run-1', platform: 'android', deviceLabel: 'device', groupId: 'MED-2',
        scenario: 'FULL-MOTION', repeat: 1, measurementMs: 60_000,
        replay: { imagePolicy: { quality: 'medium' } },
      },
      events: [
        { type: 'image_saved', timestamp: 1_000, byteSize: 10_000, priority: true, byteSizeSource: 'native' },
        { type: 'image_saved', timestamp: 30_000, byteSize: 20_000, priority: false, byteSizeSource: 'native' },
        { type: 'segment_encoded', timestamp: 30_000, byteSize: 500, pointerRecordCount: 2 },
        { type: 'capture_skipped', timestamp: 31_000, reason: 'throttle' },
      ],
      http: {
        requestCount: 2, retryCount: 0, bodyBytes: 35_000, connectionBytes: 36_000,
        requests: [
          {
            path: '/v1/write/rum/replay_assets', bodyBytes: 31_000,
            multipartFileCount: 2, multipartFileBytes: 30_000, multipartFieldCount: 1,
            multipartOverheadBytes: 1_000,
          },
          {
            path: '/v1/write/rum/replay', bodyBytes: 4_000,
            multipartFileCount: 1, multipartFileBytes: 500, multipartFieldCount: 1,
            multipartOverheadBytes: 3_500,
          },
        ],
      },
    });
    expect(run.imageBytesPerMinute).toBe(30_000);
    expect(run.rollingImageBytesMax).toBe(30_000);
    expect(run.segmentBytesPerMinute).toBe(500);
    expect(run.pointerRecordsPerMinute).toBe(2);
    expect(run.skippedThrottle).toBe(1);
    expect(run.imageBudgetPass).toBe(true);
    expect(run.v2ImageByteSizeMeasured).toBe(true);
    expect(run.uploadedImageBytes).toBe(30_000);
    expect(run.uploadedImageBytesPerMinute).toBe(30_000);
    expect(run.uploadedImageCount).toBe(2);
    expect(run.imagePayloadDeltaBytes).toBe(0);
    expect(run.imagePayloadReconciled).toBe(true);
    expect(run.segmentPayloadBytesPerMinute).toBe(500);
    expect(run.multipartOverheadBytesPerMinute).toBe(4_500);
    expect(run.httpProtocolOverheadBytesPerMinute).toBe(4_500);
    expect(run.replayHttpBodyDeltaBytes).toBe(0);
    expect(run.replayHttpBodyReconciled).toBe(true);
    const group = aggregateReplayTrafficRuns([run, { ...run, repeat: 2, imageBytesPerMinute: 33_000 }])[0];
    expect(group.repetitions).toBe(2);
    expect(group.imageBytesPerMinuteMedian).toBe(31_500);
    expect(group.imageBytesPerMinuteCV).toBeGreaterThan(0);
    expect(group.replayHttpBodyReconciled).toBe(true);
  });

  it('uses HTTP resource payload as the real legacy baseline without claiming V2 reconciliation', () => {
    const run = analyzeReplayTrafficRun({
      metadata: {
        runId: 'legacy-run', platform: 'android', deviceLabel: 'device', groupId: 'LEGACY-1',
        scenario: 'FULL-MOTION', repeat: 1, measurementMs: 120_000,
        replay: { captureFps: 1, maxImageDimension: 720 },
      },
      events: [
        { type: 'image_saved', timestamp: 1_000, byteSize: 40_960, byteSizeSource: 'frame_limit_estimate' },
      ],
      http: {
        requestCount: 1, retryCount: 0, bodyBytes: 11_000, connectionBytes: 12_000,
        requests: [{
          path: '/v1/write/rum/replay_assets', bodyBytes: 11_000,
          multipartFileCount: 1, multipartFileBytes: 10_000, multipartFieldCount: 1,
          multipartOverheadBytes: 1_000,
        }],
      },
    });
    expect(run.imageByteSizeSource).toBe('frame_limit_estimate');
    expect(run.uploadedImageBytesPerMinute).toBe(5_000);
    expect(run.imagePayloadRatio).toBeNull();
    expect(run.imagePayloadReconciled).toBeNull();
    expect(run.replayHttpBodyReconciled).toBeNull();
    expect(run.imageBudgetPass).toBeNull();
    const group = aggregateReplayTrafficRuns([run])[0];
    expect(group.imageBudgetPass).toBeNull();
    expect(group.imagePayloadReconciled).toBeNull();
    expect(group.v2ImageByteSizeMeasured).toBeNull();
    expect(group.replayHttpBodyReconciled).toBeNull();
  });
});

async function jsonRequest(url: string, method: string, body?: unknown): Promise<any> {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) throw new Error(`${method} ${url}: ${JSON.stringify(value)}`);
  return value;
}

async function multipartRequest(url: string, file: { filename: string; payload: Buffer }): Promise<any> {
  const boundary = 'ReplayTrafficBoundaryCaseSensitive';
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="app_id"\r\n\r\nlocal-test\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.filename}"\r\nContent-Type: image/webp\r\n\r\n`),
    file.payload,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': `multipart/form-data; boundary="${boundary}"` },
    body,
  });
  const value = await response.json();
  if (!response.ok) throw new Error(`POST ${url}: ${JSON.stringify(value)}`);
  return value;
}
