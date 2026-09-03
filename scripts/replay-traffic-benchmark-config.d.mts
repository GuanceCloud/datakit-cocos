export interface ReplayTrafficRunInput {
  runId: string;
  platform: 'android' | 'ios';
  deviceLabel: string;
  groupId: string;
  scenario: 'STATIC' | 'UI-DELTA' | 'FULL-MOTION';
  repeat: number;
  randomSeed?: number;
  targetFrameRate?: number;
  warmupSeconds?: number;
  measurementSeconds?: number;
  quietPeriodSeconds?: number;
  flushTimeoutSeconds?: number;
  metadata?: Record<string, unknown>;
}

export interface ReplayTrafficRunConfig extends ReplayTrafficRunInput {
  schemaVersion: 1;
  randomSeed: number;
  targetFrameRate: number;
  warmupMs: number;
  measurementMs: number;
  quietPeriodMs: number;
  flushTimeoutMs: number;
  canvas: { width: number; height: number; orientation: 'landscape' };
  replay: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export const REPLAY_TRAFFIC_SCENES: readonly string[];
export const REPLAY_TRAFFIC_GROUPS: Readonly<Record<string, Record<string, unknown>>>;
export function buildReplayTrafficRunConfig(input: ReplayTrafficRunInput): ReplayTrafficRunConfig;
export function validateReplayTrafficRunConfig(value: unknown): ReplayTrafficRunConfig;
