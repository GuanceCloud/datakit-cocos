import { execFileSync, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const runner = path.join(root, 'scripts', 'run-replay-traffic-benchmark.mjs');
const platform = readOption('--platform', 'android');
const repeats = positiveInteger(readOption('--repeats', '3'), '--repeats');
const deviceLabel = readOption('--device-label', `${platform}-emulator`);
const runPrefix = readOption('--run-prefix', `${platform}-matrix`);
const resultsRoot = readOption('--results-root');
const nativeRoot = platform === 'android'
  ? path.resolve(root, '..', 'ft-sdk-android')
  : path.resolve(root, '..', 'ft-sdk-ios');
const cocosSdkCommit = gitCommit(root);
const nativeSdkCommit = gitCommit(nativeRoot);
const passthrough = [
  ['--control-url', readOption('--control-url')],
  ['--data-port', readOption('--data-port')],
  ['--application-id', readOption('--application-id')],
  ['--device-id', readOption('--device-id')],
  ['--simulator-id', readOption('--simulator-id')],
  ['--warmup-seconds', readOption('--warmup-seconds')],
  ['--measurement-seconds', readOption('--measurement-seconds')],
  ['--quiet-period-seconds', readOption('--quiet-period-seconds')],
  ['--flush-timeout-seconds', readOption('--flush-timeout-seconds')],
].flatMap(([name, value]) => value === undefined ? [] : [name, value]);

const matrix = [
  ...forScenario('FULL-MOTION', [
    'LEGACY-1', 'LOW-2', 'MED-1', 'MED-2', 'MED-5', 'HIGH-2',
    'MED-2-NOADAPT', 'MED-2-768K',
  ]),
  ...forScenario('STATIC', ['LEGACY-1', 'LOW-2', 'MED-2', 'HIGH-2']),
  ...forScenario('UI-DELTA', ['LEGACY-1', 'LOW-2', 'MED-2', 'HIGH-2']),
  ...forScenario('STATIC', ['PTR-HIDE', 'PTR-SHOW-0', 'PTR-SHOW-2', 'PTR-SHOW-10']),
];

let completed = 0;
const total = matrix.length * repeats;
for (const { group, scenario } of matrix) {
  for (let repeat = 1; repeat <= repeats; repeat += 1) {
    const runId = [
      slug(runPrefix), slug(group), slug(scenario), `r${String(repeat).padStart(2, '0')}`,
    ].join('-');
    if (resultsRoot && await isCompleted(path.join(resultsRoot, runId, 'metadata.json'))) {
      completed += 1;
      process.stdout.write(`[replay-traffic-matrix] skip ${completed}/${total} ${runId}\n`);
      continue;
    }
    process.stdout.write(`[replay-traffic-matrix] start ${completed + 1}/${total} ${runId}\n`);
    await run([
      runner,
      '--platform', platform,
      '--device-label', deviceLabel,
      '--group', group,
      '--scenario', scenario,
      '--repeat', String(repeat),
      '--run-id', runId,
      '--cocos-sdk-commit', cocosSdkCommit,
      '--native-sdk-commit', nativeSdkCommit,
      ...passthrough,
    ]);
    completed += 1;
  }
}

process.stdout.write(`[replay-traffic-matrix] completed ${completed}/${total} runs\n`);

function forScenario(scenario, groups) {
  return groups.map((group) => ({ group, scenario }));
}

async function isCompleted(metadataPath) {
  try {
    const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
    return Number.isFinite(metadata.completedAt);
  } catch {
    return false;
  }
}

function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`Benchmark run exited with ${signal || code}`));
    });
  });
}

function positiveInteger(value, name) {
  const numeric = Number(value);
  if (!Number.isInteger(numeric) || numeric <= 0 || numeric > 99) {
    throw new RangeError(`${name} must be an integer from 1 to 99`);
  }
  return numeric;
}

function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function gitCommit(directory) {
  return execFileSync('git', ['-C', directory, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
}

function readOption(name, fallback) {
  const prefix = `${name}=`;
  const inline = process.argv.slice(2).find((argument) => argument.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}
