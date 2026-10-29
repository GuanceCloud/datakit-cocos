import { guanceSdk } from '@cloudcare/cocos-sdk/creator2';

// Use the installer with --replay --web and the adjacent project configuration.
export function startTelemetry(): void { guanceSdk.start(); }
export function levelStarted(level: number): void { guanceSdk.rum.addAction('level_started', 'game', { level }); }
export function startRecording(): void { guanceSdk.replay.start(); }
export function stopRecording(): void { guanceSdk.replay.stop(); }
export function stopTelemetry(): void { guanceSdk.stop(); }
