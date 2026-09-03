export const REPLAY_TRAFFIC_SCENES = ['STATIC', 'UI-DELTA', 'FULL-MOTION'];

export const REPLAY_TRAFFIC_GROUPS = Object.freeze({
  'LEGACY-1': {
    captureFps: 1,
    maxImageDimension: 720,
    touchPrivacy: 'hide',
  },
  'LOW-2': {
    captureFps: 2,
    imagePolicy: { quality: 'low' },
    touchPrivacy: 'hide',
  },
  'MED-1': {
    captureFps: 1,
    imagePolicy: { quality: 'medium' },
    touchPrivacy: 'hide',
  },
  'MED-2': {
    captureFps: 2,
    imagePolicy: { quality: 'medium' },
    touchPrivacy: 'hide',
  },
  'MED-5': {
    captureFps: 5,
    imagePolicy: { quality: 'medium' },
    touchPrivacy: 'hide',
  },
  'HIGH-2': {
    captureFps: 2,
    imagePolicy: { quality: 'high' },
    touchPrivacy: 'hide',
  },
  'MED-2-NOADAPT': {
    captureFps: 2,
    imagePolicy: { quality: 'medium', adaptiveCapture: false },
    touchPrivacy: 'hide',
  },
  'MED-2-768K': {
    captureFps: 2,
    imagePolicy: {
      quality: 'medium',
      maxBytesPerMinute: 786_432,
      maxFrameBytes: 40_960,
    },
    touchPrivacy: 'hide',
  },
  'PTR-HIDE': {
    captureFps: 2,
    imagePolicy: { quality: 'medium' },
    touchPrivacy: 'hide',
    tapsPerSecond: 0,
  },
  'PTR-SHOW-0': {
    captureFps: 2,
    imagePolicy: { quality: 'medium' },
    touchPrivacy: 'show',
    tapsPerSecond: 0,
  },
  'PTR-SHOW-2': {
    captureFps: 2,
    imagePolicy: { quality: 'medium' },
    touchPrivacy: 'show',
    tapsPerSecond: 2,
  },
  'PTR-SHOW-10': {
    captureFps: 2,
    imagePolicy: { quality: 'medium' },
    touchPrivacy: 'show',
    tapsPerSecond: 10,
  },
});

const FULL_MOTION_GROUPS = new Set([
  'LEGACY-1',
  'LOW-2',
  'MED-1',
  'MED-2',
  'MED-5',
  'HIGH-2',
  'MED-2-NOADAPT',
  'MED-2-768K',
]);
const LOW_MOTION_GROUPS = new Set(['LEGACY-1', 'LOW-2', 'MED-2', 'HIGH-2']);
const POINTER_GROUPS = new Set(['PTR-HIDE', 'PTR-SHOW-0', 'PTR-SHOW-2', 'PTR-SHOW-10']);

export function buildReplayTrafficRunConfig(input) {
  const groupId = requiredEnum(input.groupId, Object.keys(REPLAY_TRAFFIC_GROUPS), 'groupId');
  const scenario = requiredEnum(input.scenario, REPLAY_TRAFFIC_SCENES, 'scenario');
  validateCombination(groupId, scenario);

  const runId = requiredText(input.runId, 'runId');
  if (!/^[a-z0-9][a-z0-9._-]{5,159}$/i.test(runId)) {
    throw new TypeError('runId must contain 6-160 safe identifier characters');
  }
  const platform = requiredEnum(input.platform, ['android', 'ios'], 'platform');
  const repeat = integer(input.repeat, 'repeat', 1, 99);
  const deviceLabel = requiredText(input.deviceLabel, 'deviceLabel');

  return {
    schemaVersion: 1,
    runId,
    platform,
    deviceLabel,
    groupId,
    scenario,
    repeat,
    randomSeed: integer(input.randomSeed ?? 0x5eedc0de, 'randomSeed', 0, 0xffffffff),
    targetFrameRate: integer(input.targetFrameRate ?? 60, 'targetFrameRate', 1, 240),
    canvas: { width: 960, height: 640, orientation: 'landscape' },
    warmupMs: seconds(input.warmupSeconds, 15, 'warmupSeconds'),
    measurementMs: seconds(input.measurementSeconds, 130, 'measurementSeconds'),
    quietPeriodMs: seconds(input.quietPeriodSeconds, 10, 'quietPeriodSeconds'),
    flushTimeoutMs: seconds(input.flushTimeoutSeconds, 60, 'flushTimeoutSeconds'),
    replay: JSON.parse(JSON.stringify(REPLAY_TRAFFIC_GROUPS[groupId])),
    metadata: isRecord(input.metadata) ? { ...input.metadata } : {},
  };
}

export function validateReplayTrafficRunConfig(value) {
  if (!isRecord(value)) throw new TypeError('Benchmark run config must be an object');
  return buildReplayTrafficRunConfig({
    ...value,
    warmupSeconds: millisecondsToSeconds(value.warmupMs, 'warmupMs'),
    measurementSeconds: millisecondsToSeconds(value.measurementMs, 'measurementMs'),
    quietPeriodSeconds: millisecondsToSeconds(value.quietPeriodMs, 'quietPeriodMs'),
    flushTimeoutSeconds: millisecondsToSeconds(value.flushTimeoutMs, 'flushTimeoutMs'),
  });
}

function validateCombination(groupId, scenario) {
  if (POINTER_GROUPS.has(groupId)) {
    if (scenario !== 'STATIC') throw new TypeError(`${groupId} must use STATIC`);
    return;
  }
  const allowed = scenario === 'FULL-MOTION' ? FULL_MOTION_GROUPS : LOW_MOTION_GROUPS;
  if (!allowed.has(groupId)) throw new TypeError(`${groupId} is not in the ${scenario} matrix`);
}

function seconds(value, fallback, name) {
  const numeric = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 3600) {
    throw new RangeError(`${name} must be greater than 0 and at most 3600`);
  }
  return Math.round(numeric * 1000);
}

function millisecondsToSeconds(value, name) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) throw new RangeError(`${name} must be positive`);
  return numeric / 1000;
}

function integer(value, name, minimum, maximum) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric < minimum || numeric > maximum) {
    throw new RangeError(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return numeric;
}

function requiredEnum(value, allowed, name) {
  const text = requiredText(value, name);
  if (!allowed.includes(text)) throw new TypeError(`${name} must be one of: ${allowed.join(', ')}`);
  return text;
}

function requiredText(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${name} is required`);
  }
  return value.trim();
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
