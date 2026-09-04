import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

const DEFAULT_RESULTS_ROOT = '/tmp/ft-sdk-cocos-replay-traffic-results';
const IMAGE_BUDGETS = { low: 0.6 * 1024 * 1024, medium: 1.5 * 1024 * 1024, high: 4 * 1024 * 1024 };

export async function reportReplayTrafficBenchmark(options = {}) {
  const resultsRoot = path.resolve(options.resultsRoot || DEFAULT_RESULTS_ROOT);
  const outputDirectory = path.resolve(options.outputDirectory || path.join(resultsRoot, 'summary'));
  const runs = await readRuns(resultsRoot);
  if (runs.length === 0) throw new Error(`No completed runs found in ${resultsRoot}`);
  const rows = runs.map(analyzeReplayTrafficRun);
  const groups = aggregateReplayTrafficRuns(rows);
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeJson(path.join(outputDirectory, 'summary.json'), { generatedAt: Date.now(), runs: rows, groups }),
    writeFile(path.join(outputDirectory, 'runs.csv'), csv(rows)),
    writeFile(path.join(outputDirectory, 'summary.csv'), csv(groups)),
    writeFile(path.join(outputDirectory, 'summary.md'), markdown(rows, groups)),
  ]);
  return { resultsRoot, outputDirectory, runs: rows, groups };
}

export function analyzeReplayTrafficRun(run) {
  const { metadata, events, http } = run;
  const durationMs = positiveNumber(metadata.measurementMs, metadata.actualMeasurementMs, 130_000);
  const durationMinutes = durationMs / 60_000;
  const images = events.filter((event) => event.type === 'image_saved');
  const segments = events.filter((event) => event.type === 'segment_encoded');
  const skips = events.filter((event) => event.type === 'capture_skipped');
  const pointerEvents = events.filter((event) => event.type === 'pointer_received');
  const imageSizes = images.map((event) => event.byteSize).filter(Number.isFinite).sort((a, b) => a - b);
  const imageBytes = sum(imageSizes);
  const usesV2ImagePolicy = Boolean(metadata.replay?.imagePolicy);
  const v2ImageByteSizeMeasured = metadata.replay?.imagePolicy
    ? images.every((event) => event.byteSizeSource === 'native')
    : null;
  const v2FallbackCount = images.filter((event) => event.byteSizeSource === 'frame_limit_estimate').length;
  const segmentBytes = sum(segments.map((event) => event.byteSize));
  const pointerRecords = sum(segments.map((event) => event.pointerRecordCount));
  const replayRequests = http.requests.filter((request) => request.path.includes('/rum/replay'));
  const resourceRequests = http.requests.filter((request) => (
    request.path.includes('/rum/replay_assets') && !request.path.includes('/check/')
  ));
  const segmentRequests = http.requests.filter((request) => request.path === '/v1/write/rum/replay');
  const replayHttpBodyBytes = sum(replayRequests.map((request) => request.bodyBytes));
  const resourcePayloadAvailable = resourceRequests.some((request) => Number.isFinite(request.multipartFileBytes));
  const resourcePayloadBytes = resourcePayloadAvailable
    ? sum(resourceRequests.map((request) => request.multipartFileBytes))
    : null;
  const resourcePayloadCount = resourcePayloadAvailable
    ? sum(resourceRequests.map((request) => request.multipartFileCount))
    : null;
  const segmentPayloadAvailable = segmentRequests.some((request) => Number.isFinite(request.multipartFileBytes));
  const segmentPayloadBytes = segmentPayloadAvailable
    ? sum(segmentRequests.map((request) => request.multipartFileBytes))
    : null;
  const multipartOverheadBytes = sum(replayRequests.map((request) => request.multipartOverheadBytes));
  const replayAuxiliaryBodyBytes = sum(replayRequests
    .filter((request) => !Number.isFinite(request.multipartFileBytes))
    .map((request) => request.bodyBytes));
  const httpProtocolOverheadBytes = multipartOverheadBytes + replayAuxiliaryBodyBytes;
  const replayAccountedBytes = resourcePayloadAvailable && segmentPayloadAvailable
    ? resourcePayloadBytes + segmentPayloadBytes + httpProtocolOverheadBytes
    : null;
  const imagePayloadDeltaBytes = usesV2ImagePolicy && resourcePayloadAvailable
    ? resourcePayloadBytes - imageBytes
    : null;
  const imagePayloadRatio = usesV2ImagePolicy && resourcePayloadAvailable && imageBytes > 0
    ? resourcePayloadBytes / imageBytes
    : null;
  const skipCounts = Object.fromEntries(
    ['dedupe', 'approx_static', 'throttle', 'budget', 'busy', 'error']
      .map((reason) => [reason, skips.filter((event) => event.reason === reason).length]),
  );
  const budgetBytes = configuredBudget(metadata.replay);
  const priorityAllowance = Math.min(
    100 * 1024,
    Math.max(0, ...images.filter((event) => event.priority).map((event) => event.byteSize || 0)),
  );
  const rollingImageBytesMax = maximumRollingBytes(images, 60_000);
  return {
    runId: metadata.runId,
    platform: metadata.platform,
    deviceLabel: metadata.deviceLabel,
    groupId: metadata.groupId,
    scenario: metadata.scenario,
    repeat: metadata.repeat,
    durationSeconds: durationMs / 1000,
    imageBytes,
    imageBytesPerMinute: imageBytes / durationMinutes,
    imageByteSizeSource: usesV2ImagePolicy ? 'native' : 'frame_limit_estimate',
    imageResourceCount: images.length,
    effectiveImagesPerMinute: images.length / durationMinutes,
    imageFrameP50: percentile(imageSizes, 0.5),
    imageFrameP95: percentile(imageSizes, 0.95),
    imageFrameMax: imageSizes[imageSizes.length - 1] || 0,
    v2ImageByteSizeMeasured,
    v2FallbackCount,
    uploadedImageBytes: resourcePayloadBytes,
    uploadedImageBytesPerMinute: Number.isFinite(resourcePayloadBytes)
      ? resourcePayloadBytes / durationMinutes
      : null,
    uploadedImageCount: resourcePayloadCount,
    imagePayloadDeltaBytes,
    imagePayloadRatio,
    imagePayloadReconciled: usesV2ImagePolicy && resourcePayloadAvailable
      ? resourcePayloadBytes === imageBytes && resourcePayloadCount === images.length
      : null,
    rollingImageBytesMax,
    imageBudgetBytes: budgetBytes,
    priorityAllowanceBytes: priorityAllowance,
    imageBudgetPass: budgetBytes === undefined ? null : rollingImageBytesMax <= budgetBytes + priorityAllowance,
    segmentBytes,
    segmentBytesPerMinute: segmentBytes / durationMinutes,
    segmentCount: segments.length,
    pointerEventsReceived: pointerEvents.length,
    pointerRecords,
    pointerRecordsPerMinute: pointerRecords / durationMinutes,
    httpBodyBytes: http.bodyBytes || 0,
    httpBodyBytesPerMinute: (http.bodyBytes || 0) / durationMinutes,
    replayHttpBodyBytes,
    replayHttpBodyBytesPerMinute: replayHttpBodyBytes / durationMinutes,
    segmentPayloadBytes,
    segmentPayloadBytesPerMinute: Number.isFinite(segmentPayloadBytes)
      ? segmentPayloadBytes / durationMinutes
      : null,
    multipartOverheadBytes,
    multipartOverheadBytesPerMinute: multipartOverheadBytes / durationMinutes,
    replayAuxiliaryBodyBytes,
    httpProtocolOverheadBytesPerMinute: httpProtocolOverheadBytes / durationMinutes,
    replayHttpBodyDeltaBytes: Number.isFinite(replayAccountedBytes)
      ? replayHttpBodyBytes - replayAccountedBytes
      : null,
    replayHttpBodyReconciled: Number.isFinite(replayAccountedBytes)
      ? replayHttpBodyBytes === replayAccountedBytes
      : null,
    connectionBytes: http.connectionBytes || 0,
    connectionBytesPerMinute: (http.connectionBytes || 0) / durationMinutes,
    requestCount: http.requestCount || 0,
    replayRequestCount: replayRequests.length,
    retryCount: http.retryCount || 0,
    skippedDedupe: skipCounts.dedupe,
    skippedApproxStatic: skipCounts.approx_static,
    skippedThrottle: skipCounts.throttle,
    skippedBudget: skipCounts.budget,
    skippedBusy: skipCounts.busy,
    skippedError: skipCounts.error,
    deviceUplinkBytesPerMinute: run.device?.uplinkBytesPerMinute ?? null,
  };
}

export function aggregateReplayTrafficRuns(rows) {
  const grouped = new Map();
  for (const row of rows) {
    const key = `${row.platform}\n${row.deviceLabel}\n${row.groupId}\n${row.scenario}`;
    const values = grouped.get(key) || [];
    values.push(row);
    grouped.set(key, values);
  }
  return [...grouped.values()].map((values) => {
    const first = values[0];
    const metric = (name) => summarize(values.map((value) => value[name]));
    const image = metric('imageBytesPerMinute');
    const httpBody = metric('httpBodyBytesPerMinute');
    const connection = metric('connectionBytesPerMinute');
    const uploadedImage = metric('uploadedImageBytesPerMinute');
    const hasImagePayload = values.some((value) => Number.isFinite(value.uploadedImageBytes));
    const reconciliationResults = values
      .map((value) => value.imagePayloadReconciled)
      .filter((value) => value !== null);
    const httpAccountingResults = values
      .map((value) => value.replayHttpBodyReconciled)
      .filter((value) => value !== null);
    const budgetResults = values.map((value) => value.imageBudgetPass).filter((value) => value !== null);
    const v2Results = values.map((value) => value.v2ImageByteSizeMeasured).filter((value) => value !== null);
    return {
      platform: first.platform,
      deviceLabel: first.deviceLabel,
      groupId: first.groupId,
      scenario: first.scenario,
      repetitions: values.length,
      imageBytesPerMinuteMedian: image.median,
      imageBytesPerMinuteMin: image.min,
      imageBytesPerMinuteMax: image.max,
      imageBytesPerMinuteStdDev: image.stdDev,
      imageBytesPerMinuteCV: image.cv,
      imageByteSizeSource: values.every((value) => value.imageByteSizeSource === first.imageByteSizeSource)
        ? first.imageByteSizeSource
        : 'mixed',
      uploadedImageBytesPerMinuteMedian: hasImagePayload ? uploadedImage.median : null,
      uploadedImageBytesPerMinuteMin: hasImagePayload ? uploadedImage.min : null,
      uploadedImageBytesPerMinuteMax: hasImagePayload ? uploadedImage.max : null,
      imagePayloadDeltaBytesMedian: reconciliationResults.length > 0
        ? metric('imagePayloadDeltaBytes').median
        : null,
      imagePayloadRatioMedian: reconciliationResults.length > 0 ? metric('imagePayloadRatio').median : null,
      imagePayloadReconciled: reconciliationResults.length > 0
        ? reconciliationResults.every(Boolean)
        : null,
      v2ImageByteSizeMeasured: v2Results.length > 0 ? v2Results.every(Boolean) : null,
      v2FallbackCountTotal: sum(values.map((value) => value.v2FallbackCount)),
      rollingImageBytesMax: Math.max(...values.map((value) => value.rollingImageBytesMax)),
      imageBudgetPass: budgetResults.length > 0 ? budgetResults.every(Boolean) : null,
      segmentBytesPerMinuteMedian: metric('segmentBytesPerMinute').median,
      segmentPayloadBytesPerMinuteMedian: metric('segmentPayloadBytesPerMinute').median,
      multipartOverheadBytesPerMinuteMedian: metric('multipartOverheadBytesPerMinute').median,
      httpProtocolOverheadBytesPerMinuteMedian: metric('httpProtocolOverheadBytesPerMinute').median,
      replayHttpBodyReconciled: httpAccountingResults.length > 0
        ? httpAccountingResults.every(Boolean)
        : null,
      pointerRecordsPerMinuteMedian: metric('pointerRecordsPerMinute').median,
      replayHttpBodyBytesPerMinuteMedian: metric('replayHttpBodyBytesPerMinute').median,
      httpBodyBytesPerMinuteMedian: httpBody.median,
      connectionBytesPerMinuteMedian: connection.median,
      requestCountMedian: metric('requestCount').median,
      retryCountTotal: sum(values.map((value) => value.retryCount)),
      effectiveImagesPerMinuteMedian: metric('effectiveImagesPerMinute').median,
      skippedDedupeTotal: sum(values.map((value) => value.skippedDedupe)),
      skippedApproxStaticTotal: sum(values.map((value) => value.skippedApproxStatic)),
      skippedThrottleTotal: sum(values.map((value) => value.skippedThrottle)),
      skippedBudgetTotal: sum(values.map((value) => value.skippedBudget)),
      skippedErrorTotal: sum(values.map((value) => value.skippedError)),
    };
  }).sort(compareGroup);
}

function configuredBudget(replay) {
  if (!replay?.imagePolicy) return undefined;
  if (Number.isFinite(replay.imagePolicy.maxBytesPerMinute)) return replay.imagePolicy.maxBytesPerMinute;
  return IMAGE_BUDGETS[replay.imagePolicy.quality || 'medium'];
}

function maximumRollingBytes(events, windowMs) {
  const sorted = events
    .filter((event) => Number.isFinite(event.timestamp) && Number.isFinite(event.byteSize))
    .sort((a, b) => a.timestamp - b.timestamp);
  let maximum = 0;
  let total = 0;
  let left = 0;
  for (let right = 0; right < sorted.length; right += 1) {
    total += sorted[right].byteSize;
    while (sorted[right].timestamp - sorted[left].timestamp >= windowMs) {
      total -= sorted[left].byteSize;
      left += 1;
    }
    maximum = Math.max(maximum, total);
  }
  return maximum;
}

function summarize(input) {
  const values = input.filter(Number.isFinite).sort((a, b) => a - b);
  if (values.length === 0) return { median: 0, min: 0, max: 0, stdDev: 0, cv: null };
  const median = percentile(values, 0.5);
  const mean = sum(values) / values.length;
  const variance = sum(values.map((value) => (value - mean) ** 2)) / values.length;
  const stdDev = Math.sqrt(variance);
  return { median, min: values[0], max: values[values.length - 1], stdDev, cv: mean === 0 ? null : stdDev / mean };
}

function percentile(sorted, quantile) {
  if (sorted.length === 0) return 0;
  const index = (sorted.length - 1) * quantile;
  const lower = Math.floor(index);
  const fraction = index - lower;
  return sorted[lower] + (sorted[Math.min(sorted.length - 1, lower + 1)] - sorted[lower]) * fraction;
}

async function readRuns(resultsRoot) {
  const entries = await readdir(resultsRoot, { withFileTypes: true });
  const runs = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'summary') continue;
    const directory = path.join(resultsRoot, entry.name);
    try {
      const [metadata, events, http, device] = await Promise.all([
        readJson(path.join(directory, 'metadata.json')),
        readJson(path.join(directory, 'sdk-events.json')),
        readJson(path.join(directory, 'http.json')),
        readJson(path.join(directory, 'device-network.json')).catch(() => undefined),
      ]);
      runs.push({ metadata, events, http, device });
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return runs;
}

function markdown(rows, groups) {
  const lines = [
    '# Cocos Session Replay Real-Traffic Benchmark',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    'HTTP body bytes are the actual application request bodies received by the local data port. Connection bytes include HTTP request lines, headers, and bodies received by that port, but not TCP/IP framing.',
    '',
    '| Platform | Device | Group | Scenario | Runs | SDK image/min median (range) | SDK byte source | Uploaded image/min | Image payload ratio | Rolling 60s max | SDK segment/min | Uploaded segment/min | Protocol body overhead/min | Replay HTTP body/min | Connection/min | CV | Budget | Image reconciled | HTTP accounted |',
    '| --- | --- | --- | --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- | --- |',
  ];
  for (const group of groups) {
    const reconciled = group.imagePayloadReconciled === null ? 'n/a' : group.imagePayloadReconciled ? 'PASS' : 'FAIL';
    const budget = group.imageBudgetPass === null ? 'n/a' : group.imageBudgetPass ? 'PASS' : 'FAIL';
    const httpAccounted = group.replayHttpBodyReconciled === null
      ? 'n/a'
      : group.replayHttpBodyReconciled ? 'PASS' : 'FAIL';
    lines.push(`| ${group.platform} | ${group.deviceLabel} | ${group.groupId} | ${group.scenario} | ${group.repetitions} | ${bytes(group.imageBytesPerMinuteMedian)} (${bytes(group.imageBytesPerMinuteMin)}–${bytes(group.imageBytesPerMinuteMax)}) | ${group.imageByteSizeSource} | ${bytes(group.uploadedImageBytesPerMinuteMedian)} | ${ratio(group.imagePayloadRatioMedian)} | ${bytes(group.rollingImageBytesMax)} | ${bytes(group.segmentBytesPerMinuteMedian)} | ${bytes(group.segmentPayloadBytesPerMinuteMedian)} | ${bytes(group.httpProtocolOverheadBytesPerMinuteMedian)} | ${bytes(group.replayHttpBodyBytesPerMinuteMedian)} | ${bytes(group.connectionBytesPerMinuteMedian)} | ${ratio(group.imageBytesPerMinuteCV)} | ${budget} | ${reconciled} | ${httpAccounted} |`);
  }
  lines.push('', '## Run validity', '');
  const invalid = rows.filter((row) => (
    row.skippedError > 0 || row.retryCount > 0 || row.imageBudgetPass === false
    || row.imagePayloadReconciled === false || row.v2ImageByteSizeMeasured === false
    || row.replayHttpBodyReconciled === false
  ));
  if (invalid.length === 0) lines.push('No SDK capture errors, HTTP retries, image-budget failures, image-payload reconciliation failures, or HTTP accounting gaps were detected.');
  else for (const row of invalid) lines.push(`- ${row.runId}: errors=${row.skippedError}, retries=${row.retryCount}, budget=${row.imageBudgetPass}, imageReconciled=${row.imagePayloadReconciled}, httpAccounted=${row.replayHttpBodyReconciled}, v2Measured=${row.v2ImageByteSizeMeasured}`);
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function csv(rows) {
  if (rows.length === 0) return '';
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  return `${columns.join(',')}\n${rows.map((row) => columns.map((column) => csvValue(row[column])).join(',')).join('\n')}\n`;
}

function csvValue(value) {
  if (value === undefined || value === null) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function bytes(value) {
  if (!Number.isFinite(value)) return 'n/a';
  return `${(value / 1024).toFixed(1)} KiB`;
}

function ratio(value) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : 'n/a';
}

function compareGroup(left, right) {
  return `${left.platform}/${left.deviceLabel}/${left.groupId}/${left.scenario}`
    .localeCompare(`${right.platform}/${right.deviceLabel}/${right.groupId}/${right.scenario}`);
}

function positiveNumber(...values) {
  return values.find((value) => Number.isFinite(value) && value > 0);
}

function sum(values) {
  return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function readOption(name, fallback) {
  const prefix = `${name}=`;
  const inline = process.argv.slice(2).find((argument) => argument.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const result = await reportReplayTrafficBenchmark({
    resultsRoot: readOption('--results-root', DEFAULT_RESULTS_ROOT),
    outputDirectory: readOption('--output-dir', undefined),
  });
  process.stdout.write(`[replay-traffic] summarized ${result.runs.length} runs in ${result.outputDirectory}\n`);
}
