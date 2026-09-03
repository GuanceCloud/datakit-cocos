import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const outputRoot = path.resolve(readOption('--output-root') || process.cwd());
const nativeHostDirectory = readRelativeDirectoryOption('--native-host-dir', 'examples/hybrid-creator3/native-host');
const dataUrl = httpUrl(process.env.REPLAY_TRAFFIC_DATA_URL, 'REPLAY_TRAFFIC_DATA_URL');
const controlUrl = httpUrl(process.env.REPLAY_TRAFFIC_CONTROL_URL, 'REPLAY_TRAFFIC_CONTROL_URL');
const androidAppId = optional(process.env.REPLAY_TRAFFIC_ANDROID_APP_ID) || 'cocos-replay-benchmark-android';
const iosAppId = optional(process.env.REPLAY_TRAFFIC_IOS_APP_ID) || 'cocos-replay-benchmark-ios';
const bootstrap = JSON.stringify({ enabled: true, controlUrl });

const files = {
  'android/HybridSampleEnvironment.java': androidSampleEnvironment(dataUrl, androidAppId),
  'ios/HybridSampleEnvironment.generated.h': iosSampleEnvironment(dataUrl, iosAppId),
  'android/ReplayTrafficBenchmarkEnvironment.java': androidBenchmarkEnvironment(bootstrap),
  'ios/ReplayTrafficBenchmarkEnvironment.generated.h': iosBenchmarkEnvironment(bootstrap),
};

await Promise.all(Object.entries(files).map(async ([relativePath, source]) => {
  const destination = path.join(outputRoot, nativeHostDirectory, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, source);
}));
process.stdout.write(`Generated ${Object.keys(files).length} ignored Replay Traffic Benchmark configuration files.\n`);

function androidSampleEnvironment(url, appId) {
  return [
    '// Generated for the local Replay Traffic Benchmark; do not commit.',
    'package com.cloudcare.cocos.sample;',
    '',
    'final class HybridSampleEnvironment {',
    `    static final String DATAKIT_URL = ${JSON.stringify(url)};`,
    '    static final String DATAWAY_URL = null;',
    '    static final String CLIENT_TOKEN = null;',
    `    static final String ANDROID_RUM_APP_ID = ${JSON.stringify(appId)};`,
    '    static final String SERVICE_NAME = "cocos-replay-traffic-benchmark";',
    '    static final String ENV = "benchmark";',
    '    static final boolean DEBUG = false;',
    '',
    '    private HybridSampleEnvironment() {}',
    '}',
    '',
  ].join('\n');
}

function iosSampleEnvironment(url, appId) {
  return [
    '// Generated for the local Replay Traffic Benchmark; do not commit.',
    '#import <Foundation/Foundation.h>',
    '',
    `static NSString * const FTHybridSampleDatakitURL = @${objectiveCString(url)};`,
    'static NSString * const FTHybridSampleDatawayURL = nil;',
    'static NSString * const FTHybridSampleClientToken = nil;',
    `static NSString * const FTHybridSampleIOSRumAppID = @${objectiveCString(appId)};`,
    'static NSString * const FTHybridSampleServiceName = @"cocos-replay-traffic-benchmark";',
    'static NSString * const FTHybridSampleEnv = @"benchmark";',
    'static const BOOL FTHybridSampleDebug = NO;',
    '',
  ].join('\n');
}

function androidBenchmarkEnvironment(json) {
  return [
    '// Generated for the local Replay Traffic Benchmark; do not commit.',
    'package com.cloudcare.cocos.sample;',
    '',
    'final class ReplayTrafficBenchmarkEnvironment {',
    `    static final String CONFIG_JSON = ${JSON.stringify(json)};`,
    '    private ReplayTrafficBenchmarkEnvironment() {}',
    '}',
    '',
  ].join('\n');
}

function iosBenchmarkEnvironment(json) {
  return [
    '// Generated for the local Replay Traffic Benchmark; do not commit.',
    '#import <Foundation/Foundation.h>',
    '',
    `static NSString * const FTReplayTrafficBenchmarkBootstrapJSON = @${objectiveCString(json)};`,
    '',
  ].join('\n');
}

function objectiveCString(value) {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function httpUrl(value, name) {
  const text = optional(value);
  if (!text) fail(`${name} is required.`);
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    fail(`${name} must be an absolute HTTP URL.`);
  }
  if (parsed.protocol !== 'http:') fail(`${name} must use http:// for the isolated local receiver.`);
  if (parsed.username || parsed.password) fail(`${name} must not contain credentials.`);
  return parsed.href.replace(/\/$/, '');
}

function readOption(name) {
  const argumentsList = process.argv.slice(2);
  const exactIndex = argumentsList.indexOf(name);
  if (exactIndex >= 0) return argumentsList[exactIndex + 1];
  const prefix = `${name}=`;
  return argumentsList.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

function readRelativeDirectoryOption(name, fallback) {
  const value = readOption(name) || fallback;
  const normalized = path.normalize(value);
  if (path.isAbsolute(normalized) || normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    fail(`${name} must stay inside --output-root.`);
  }
  return normalized;
}

function optional(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function fail(message) {
  process.stderr.write(`[replay-traffic] ${message}\n`);
  process.exit(1);
}
