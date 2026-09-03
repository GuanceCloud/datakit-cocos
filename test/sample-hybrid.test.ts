import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const cocosBootstraps = [
  'examples/creator2/SdkBootstrap.ts',
  'examples/creator3/SdkBootstrap.ts',
  'examples/creator2-app/assets/Script/SdkBootstrap.ts',
];

describe('Hybrid diagnostic sample integration', () => {
  it.each(cocosBootstraps)('%s attaches, enters, and exposes the native exit boundary', (relativePath) => {
    const source = sourceAt(relativePath);
    expect(source).toContain('guanceSdk.attach({');
    expect(source).toContain('guanceSdk.enterCocos();');
    expect(source).toContain('guanceSdk.leaveCocos();');
    expect(source).not.toContain('guanceSdk.start(');
    expect(source).not.toContain('SampleEnvironment.generated');
  });

  it('initializes every native feature required by the Android Hybrid sample', () => {
    const source = sourceAt('examples/native-host/android/HybridSampleSdk.java');
    expect(source).toContain('FTSdk.install(sdkConfig)');
    expect(source).toContain('FTSdk.initRUMWithConfig');
    expect(source).toContain('FTSdk.initLogWithConfig');
    expect(source).toContain('FTSdk.initTraceWithConfig');
    expect(source).toContain('FTSdk.initSessionReplayConfig');
  });

  it('initializes every native feature required by the iOS Hybrid sample', () => {
    const source = sourceAt('examples/native-host/ios/HybridSampleSDK.m');
    expect(source).toContain('[FTMobileAgent startWithConfigOptions:sdkConfig]');
    expect(source).toContain('startRumWithConfigOptions:rumConfig');
    expect(source).toContain('startLoggerWithConfigOptions:loggerConfig');
    expect(source).toContain('startTraceWithConfigOptions:traceConfig');
    expect(source).toContain('startWithSessionReplayConfig:replayConfig');
  });
});

function sourceAt(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}
