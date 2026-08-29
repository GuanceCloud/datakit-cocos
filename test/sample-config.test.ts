import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const temporaryDirectories: string[] = [];
const generatedTargets = [
  'examples/creator2/SampleEnvironment.generated.ts',
  'examples/creator3/SampleEnvironment.generated.ts',
  'examples/creator2-app/assets/Script/SampleEnvironment.generated.ts',
];

afterEach(() => {
  temporaryDirectories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }));
});

describe('Sample environment configuration', () => {
  it('generates equivalent ignored modules without printing credentials', () => {
    const outputRoot = temporaryRoot();
    const environment = cleanEnvironment({
      SAMPLE_DATAWAY_URL: 'https://openway.example.test',
      SAMPLE_CLIENT_TOKEN: 'sample-client-token',
      SAMPLE_ANDROID_APP_ID: 'android-sample-app',
      SAMPLE_IOS_APP_ID: 'ios-sample-app',
      SAMPLE_ENV: 'integration',
      SAMPLE_DEBUG: 'false',
    });

    const output = execFileSync(
      process.execPath,
      ['scripts/configure-sample.mjs', '--output-root', outputRoot],
      { cwd: process.cwd(), encoding: 'utf8', env: environment },
    );

    const sources = generatedTargets.map((target) => readFileSync(path.join(outputRoot, target), 'utf8'));
    expect(new Set(sources)).toHaveLength(1);
    expect(sources[0]).toContain('"datawayUrl": "https://openway.example.test"');
    expect(sources[0]).toContain('"clientToken": "sample-client-token"');
    expect(sources[0]).toContain('"env": "integration"');
    expect(sources[0]).toContain('"debug": false');
    expect(output).not.toContain('sample-client-token');
  });

  it('requires one endpoint mode and at least one platform app ID', () => {
    const outputRoot = temporaryRoot();
    expect(() => execFileSync(
      process.execPath,
      ['scripts/configure-sample.mjs', '--output-root', outputRoot],
      { cwd: process.cwd(), stdio: 'pipe', env: cleanEnvironment() },
    )).toThrow();
  });
});

function temporaryRoot(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'cocos-sdk-sample-'));
  temporaryDirectories.push(directory);
  return directory;
}

function cleanEnvironment(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (key.startsWith('SAMPLE_')) delete environment[key];
  }
  return { ...environment, ...overrides };
}
