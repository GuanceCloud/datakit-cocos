import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { buildReplayTrafficRunConfig } from './replay-traffic-benchmark-config.mjs';

const execFileAsync = promisify(execFile);
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const controlUrl = (readOption('--control-url', 'http://127.0.0.1:9530')).replace(/\/$/, '');
const platform = readRequired('--platform');
const groupId = readRequired('--group');
const scenario = readRequired('--scenario');
const repeat = Number(readOption('--repeat', '1'));
const deviceLabel = readOption('--device-label', `${platform}-reference`);
const runId = readOption('--run-id', defaultRunId(platform, deviceLabel, groupId, scenario, repeat));
const applicationId = readOption('--application-id', 'com.cloudcare.sample.cocos.hybrid.creator3');
const metadata = await repositoryMetadata(platform);
const config = buildReplayTrafficRunConfig({
  runId,
  platform,
  deviceLabel,
  groupId,
  scenario,
  repeat,
  metadata,
});

await request('/health');
await request('/config', { method: 'PUT', body: config });

let androidNetworkStart;
let androidUid;
if (platform === 'android') {
  await adb('reverse', 'tcp:9529', 'tcp:9529');
  await adb('reverse', 'tcp:9530', 'tcp:9530');
  const model = clean(await adb('shell', 'getprop', 'ro.product.model'));
  const osVersion = clean(await adb('shell', 'getprop', 'ro.build.version.release'));
  const screen = clean(await adb('shell', 'wm', 'size'));
  config.metadata = { ...config.metadata, deviceModel: model, osVersion, screen };
  await request('/config', { method: 'PUT', body: config });
  androidUid = parseUid(await adb('shell', 'dumpsys', 'package', applicationId));
  await adb('shell', 'am', 'force-stop', applicationId);
  await adb('shell', 'am', 'start', '-n', `${applicationId}/com.cocos.game.AppActivity`);
} else if (platform === 'ios') {
  const deviceId = readOption('--device-id');
  if (deviceId) {
    await execFileAsync('xcrun', [
      'devicectl', 'device', 'process', 'launch', '--terminate-existing',
      '--device', deviceId, applicationId,
    ], { maxBuffer: 1024 * 1024 });
  } else {
    process.stdout.write('[replay-traffic] iOS run configured; launch the benchmark app on the connected iPhone now.\n');
  }
} else {
  throw new TypeError('--platform must be android or ios');
}

const deadline = Date.now() + config.warmupMs + config.measurementMs + config.flushTimeoutMs + 120_000;
let sawRunning = false;
while (Date.now() < deadline) {
  const status = await request('/status');
  if (status.state === 'running' && !sawRunning) {
    sawRunning = true;
    if (platform === 'android' && androidUid) androidNetworkStart = await androidTxBytes(androidUid);
    process.stdout.write(`[replay-traffic] ${runId} measurement started.\n`);
  }
  if (status.state === 'completed' && status.runId === runId) {
    if (platform === 'android' && androidUid && Number.isFinite(androidNetworkStart)) {
      const end = await androidTxBytes(androidUid);
      if (Number.isFinite(end) && end >= androidNetworkStart) {
        const directory = status.resultDirectory;
        await mkdir(directory, { recursive: true });
        await writeFile(path.join(directory, 'device-network.json'), `${JSON.stringify({
          source: 'android-proc-uid-stat',
          uplinkBytes: end - androidNetworkStart,
          uplinkBytesPerMinute: (end - androidNetworkStart) / (config.measurementMs / 60_000),
          includesFlushWindow: true,
        }, null, 2)}\n`);
      }
    }
    process.stdout.write(`[replay-traffic] completed ${runId}: ${status.resultDirectory}\n`);
    process.exit(0);
  }
  await delay(1000);
}
throw new Error(`Timed out waiting for ${runId} to complete`);

async function repositoryMetadata(targetPlatform) {
  const nativeRoot = targetPlatform === 'android'
    ? path.resolve(root, '..', 'ft-sdk-android')
    : path.resolve(root, '..', 'ft-sdk-ios');
  const [sdkCommit, sdkStatus, nativeCommit, nativeStatus] = await Promise.all([
    git(root, 'rev-parse', 'HEAD'),
    git(root, 'status', '--porcelain'),
    git(nativeRoot, 'rev-parse', 'HEAD'),
    git(nativeRoot, 'status', '--porcelain'),
  ]);
  return {
    cocosCreatorVersion: '3.8.8',
    cocosSdkCommit: clean(sdkCommit),
    cocosSdkDirty: clean(sdkStatus).length > 0,
    nativeSdkCommit: clean(nativeCommit),
    nativeSdkDirty: clean(nativeStatus).length > 0,
    buildType: 'debug-benchmark',
  };
}

async function git(directory, ...args) {
  return (await execFileAsync('git', ['-C', directory, ...args], { maxBuffer: 1024 * 1024 })).stdout;
}

async function adb(...args) {
  const result = await execFileAsync('adb', args, { maxBuffer: 1024 * 1024 });
  return result.stdout;
}

async function androidTxBytes(uid) {
  try {
    const value = clean(await adb('shell', 'cat', `/proc/uid_stat/${uid}/tcp_snd`));
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : undefined;
  } catch {
    return undefined;
  }
}

function parseUid(output) {
  const match = output.match(/\buserId=(\d+)/);
  return match?.[1];
}

async function request(route, options = {}) {
  const response = await fetch(`${controlUrl}${route}`, {
    method: options.method || 'GET',
    headers: options.body ? { 'content-type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const value = await response.json();
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${route}: ${value.error || response.status}`);
  return value;
}

function defaultRunId(targetPlatform, label, group, load, runRepeat) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return [targetPlatform, slug(label), slug(group), slug(load), `r${String(runRepeat).padStart(2, '0')}`, stamp]
    .join('-');
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function clean(value) {
  return String(value || '').trim();
}

function readRequired(name) {
  const value = readOption(name);
  if (!value) throw new TypeError(`${name} is required`);
  return value;
}

function readOption(name, fallback) {
  const prefix = `${name}=`;
  const inline = process.argv.slice(2).find((argument) => argument.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
