import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildReplayTrafficRunConfig,
  REPLAY_TRAFFIC_GROUPS,
} from '../scripts/replay-traffic-benchmark-config.mjs';
import { createReplayTrafficCaptureServer } from '../scripts/replay-traffic-capture-server.mjs';
import {
  analyzeReplayTrafficRun,
  aggregateReplayTrafficRuns,
} from '../scripts/report-replay-traffic-benchmark.mjs';
import { emitReplayDiagnostic, replayUtf8ByteLength } from '../src/core/replay-diagnostics.js';

describe('Replay Traffic Benchmark configuration', () => {
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
      await jsonRequest(`${control}/runs/start`, 'POST', { runId: config.runId });
      const check = await jsonRequest(`${data}/v1/check/rum/replay_assets`, 'POST', {
        app_id: 'local-test',
        files: ['resource-a.webp', 'resource-b.webp'],
      });
      expect(check.content).toEqual({ 'resource-a.webp': false, 'resource-b.webp': false });
      await jsonRequest(`${data}/v1/write/rum/replay`, 'POST', { segment: 'synthetic' });
      await jsonRequest(`${data}/v1/write/rum/replay`, 'POST', { segment: 'synthetic' });
      await jsonRequest(`${control}/runs/${config.runId}/events`, 'POST', {
        events: [{ type: 'image_saved', timestamp: Date.now(), byteSize: 1024 }],
      });
      const stopped = await jsonRequest(`${control}/runs/${config.runId}/stop`, 'POST', {});
      const httpSource = await readFile(path.join(stopped.resultDirectory, 'http.json'), 'utf8');
      const httpStats = JSON.parse(httpSource);
      expect(httpStats.requestCount).toBe(3);
      expect(httpStats.retryCount).toBe(1);
      expect(httpStats.bodyBytes).toBeGreaterThan(0);
      expect(httpStats.connectionBytes).toBeGreaterThan(httpStats.bodyBytes);
      expect(httpSource).not.toContain('synthetic');
      expect(httpSource).not.toContain('local-test');
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
        { type: 'image_saved', timestamp: 1_000, byteSize: 10_000, priority: true },
        { type: 'image_saved', timestamp: 30_000, byteSize: 20_000, priority: false },
        { type: 'segment_encoded', timestamp: 30_000, byteSize: 500, pointerRecordCount: 2 },
        { type: 'capture_skipped', timestamp: 31_000, reason: 'throttle' },
      ],
      http: {
        requestCount: 1, retryCount: 0, bodyBytes: 35_000, connectionBytes: 36_000,
        requests: [{ path: '/v1/write/rum/replay', bodyBytes: 35_000 }],
      },
    });
    expect(run.imageBytesPerMinute).toBe(30_000);
    expect(run.rollingImageBytesMax).toBe(30_000);
    expect(run.segmentBytesPerMinute).toBe(500);
    expect(run.pointerRecordsPerMinute).toBe(2);
    expect(run.skippedThrottle).toBe(1);
    expect(run.imageBudgetPass).toBe(true);
    const group = aggregateReplayTrafficRuns([run, { ...run, repeat: 2, imageBytesPerMinute: 33_000 }])[0];
    expect(group.repetitions).toBe(2);
    expect(group.imageBytesPerMinuteMedian).toBe(31_500);
    expect(group.imageBytesPerMinuteCV).toBeGreaterThan(0);
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
