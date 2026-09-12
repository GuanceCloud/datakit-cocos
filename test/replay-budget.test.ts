import { describe, expect, it } from 'vitest';
import { FTReplayBudget, REPLAY_KEY_FRAME_BURST_BYTES } from '../src/session-replay/core/replay-budget';
import { replayImagePolicy } from '../src/session-replay/core/validation';

describe('replay image policy', () => {
  it('expands presets while preserving explicit limits', () => {
    expect(replayImagePolicy({})).toMatchObject({
      quality: 'medium',
      compressionQuality: 0.45,
      maxImageDimension: 720,
      maxFrameBytes: 40 * 1024,
      maxBytesPerMinute: Math.round(1.5 * 1024 * 1024),
      adaptiveCapture: true,
    });
    expect(replayImagePolicy({
      maxImageDimension: 640,
      imagePolicy: {
        quality: 'high',
        maxFrameBytes: 32 * 1024,
        maxBytesPerMinute: 2 * 1024 * 1024,
        adaptiveCapture: false,
      },
    })).toMatchObject({
      quality: 'high',
      compressionQuality: 0.6,
      maxImageDimension: 640,
      maxFrameBytes: 32 * 1024,
      maxBytesPerMinute: 2 * 1024 * 1024,
      adaptiveCapture: false,
    });
  });

  it('rejects invalid policy values', () => {
    expect(() => replayImagePolicy({ imagePolicy: { quality: 'ultra' as 'high' } })).toThrow(/quality/);
    expect(() => replayImagePolicy({ imagePolicy: { maxFrameBytes: 100 } })).toThrow(/maxFrameBytes/);
    expect(() => replayImagePolicy({ imagePolicy: { adaptiveCapture: 'yes' as unknown as boolean } })).toThrow(/boolean/);
  });
});

describe('replay rolling budget', () => {
  const policy = replayImagePolicy({
    maxImageDimension: 800,
    imagePolicy: { maxFrameBytes: 4 * 1024, maxBytesPerMinute: 16 * 1024 },
  });

  it('releases bytes after 60 seconds', () => {
    const budget = new FTReplayBudget(policy);
    budget.record(1_000, 16 * 1024);
    expect(budget.decide(1_001).allowed).toBe(false);
    expect(budget.decide(61_000).allowed).toBe(true);
  });

  it('throttles at 75%, degrades at 90%, and stops at 100%', () => {
    const budget = new FTReplayBudget(policy);
    budget.record(1_000, 12 * 1024);
    expect(budget.decide(18_000)).toMatchObject({ allowed: true, maxImageDimension: 800 });
    expect(budget.decide(18_500)).toMatchObject({ allowed: false, reason: 'throttle' });
    budget.record(18_600, 3 * 1024);
    expect(budget.decide(32_000)).toMatchObject({
      allowed: true,
      maxImageDimension: 600,
      compressionQuality: 0.34,
      maxFrameBytes: 1024,
    });
    budget.record(32_100, 1024);
    expect(budget.decide(34_100)).toMatchObject({ allowed: false, reason: 'budget' });
  });

  it('allows one independent key-frame burst for a new view', () => {
    const budget = new FTReplayBudget(policy);
    budget.record(1_000, 16 * 1024);
    const first = budget.decide(2_000, 'session:view-2');
    expect(first.allowed).toBe(true);
    expect(first.maxFrameBytes).toBe(REPLAY_KEY_FRAME_BURST_BYTES);
    budget.record(2_000, first.maxFrameBytes, 'session:view-2');
    expect(budget.decide(4_000, 'session:view-2').allowed).toBe(false);
  });

  it('uses hysteresis before restoring image size', () => {
    const budget = new FTReplayBudget(policy);
    budget.record(0, 1024);
    budget.record(1_000, 14 * 1024);
    expect(budget.decide(2_000).maxImageDimension).toBe(600);
    expect(budget.decide(60_001).maxImageDimension).toBe(600);
  });

  it('spreads continuous images across rolling windows without exhausting the budget', () => {
    const config = replayImagePolicy({});
    const budget = new FTReplayBudget(config);
    const saved: number[] = [];
    for (let time = 0; time <= 180_000; time += 500) {
      const decision = budget.decide(time, time === 0 ? 'view' : undefined);
      expect(decision.reason).not.toBe('budget');
      if (!decision.allowed) continue;
      budget.record(time, decision.maxFrameBytes, time === 0 ? 'view' : undefined);
      saved.push(time);
      expect(budget.usedBytes(time)).toBeLessThanOrEqual(config.maxBytesPerMinute);
    }
    expect(saved.length).toBeGreaterThan(80);
    expect(Math.max(...saved.slice(1).map((time, i) => time - saved[i]!))).toBeLessThanOrEqual(2_000);
  });

  it('keeps pacing optional and lets new views bypass it', () => {
    const budget = new FTReplayBudget(policy);
    budget.record(0, 1024, 'view-1');
    expect(budget.decide(1).reason).toBe('throttle');
    expect(budget.decide(1, 'view-2').allowed).toBe(true);
    budget.reset();
    expect(budget.decide(1).allowed).toBe(true);
    const fixed = new FTReplayBudget({ ...policy, adaptiveCapture: false });
    fixed.record(0, 1024);
    expect(fixed.decide(1).allowed).toBe(true);
    fixed.record(1, 15 * 1024);
    expect(fixed.decide(2).reason).toBe('budget');
  });
});
