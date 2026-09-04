import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { gunzipSync, inflateSync } from 'node:zlib';
import { validateReplayTrafficRunConfig } from './replay-traffic-benchmark-config.mjs';

const DEFAULT_RESULTS_ROOT = '/tmp/ft-sdk-cocos-replay-traffic-results';
const MAX_CONTROL_BODY_BYTES = 8 * 1024 * 1024;
const MAX_DATA_BODY_BYTES = 128 * 1024 * 1024;

export function createReplayTrafficCaptureServer(options = {}) {
  const host = options.host || '0.0.0.0';
  const dataPort = numberOption(options.dataPort, 19529);
  const controlPort = numberOption(options.controlPort, 19530);
  const resultsRoot = path.resolve(options.resultsRoot || DEFAULT_RESULTS_ROOT);
  let configuredRun;
  let activeRun;
  let lastCompletedRun;
  let lastDataAt;
  let dataRequestCount = 0;
  let dataBodyBytes = 0;

  const dataServer = http.createServer(async (request, response) => {
    const receivedAt = Date.now();
    try {
      const body = await readBody(request, MAX_DATA_BODY_BYTES);
      lastDataAt = Date.now();
      dataRequestCount += 1;
      dataBodyBytes += body.length;
      if (activeRun) {
        const contentType = headerValue(request.headers['content-type']);
        const contentEncoding = headerValue(request.headers['content-encoding'])?.toLowerCase();
        const requestRecord = {
          timestamp: receivedAt,
          method: request.method || 'UNKNOWN',
          path: safePath(request.url),
          contentType,
          contentEncoding,
          bodyBytes: body.length,
          bodySha256: createHash('sha256').update(body).digest('hex'),
          ...multipartSummary(body, contentType),
        };
        activeRun.requests.push(requestRecord);
        activeRun.bodyBytes += body.length;
        activeRun.lastDataAt = lastDataAt;
      }

      if (safePath(request.url) === '/v1/check/rum/replay_assets') {
        const files = replayCheckFiles(body, request.headers['content-encoding']);
        if (files.length === 0) return json(response, 400, { error: 'replay asset check contained no files' });
        return json(response, 200, {
          content: Object.fromEntries(files.map((file) => [file, false])),
        });
      }
      return json(response, 200, { content: {} });
    } catch (error) {
      return json(response, error?.statusCode || 500, { error: safeError(error) });
    }
  });

  dataServer.on('connection', (socket) => {
    socket.on('data', (chunk) => {
      if (activeRun) activeRun.connectionBytes += chunk.length;
    });
  });

  const controlServer = http.createServer(async (request, response) => {
    try {
      const route = safePath(request.url);
      if (request.method === 'GET' && route === '/health') {
        return json(response, 200, { ok: true });
      }
      if (request.method === 'PUT' && route === '/config') {
        if (activeRun) return json(response, 409, { error: 'a run is active' });
        configuredRun = validateReplayTrafficRunConfig(await readJson(request));
        return json(response, 200, { ok: true, runId: configuredRun.runId });
      }
      if (request.method === 'GET' && route === '/config') {
        if (!configuredRun) return json(response, 404, { error: 'no run configured' });
        return json(response, 200, configuredRun);
      }
      if (request.method === 'POST' && route === '/runs/start') {
        const marker = await readJson(request);
        if (!configuredRun) return json(response, 409, { error: 'no run configured' });
        if (activeRun) return json(response, 409, { error: 'a run is already active' });
        if (marker.runId !== configuredRun.runId) return json(response, 409, { error: 'runId mismatch' });
        activeRun = {
          config: configuredRun,
          measurementStartedAt: Date.now(),
          connectionBytes: 0,
          bodyBytes: 0,
          lastDataAt: undefined,
          requests: [],
          sdkEvents: [],
        };
        return json(response, 200, { ok: true, runId: configuredRun.runId });
      }
      const eventsMatch = route.match(/^\/runs\/([^/]+)\/events$/);
      if (request.method === 'POST' && eventsMatch) {
        const run = requireActiveRun(eventsMatch[1]);
        const input = await readJson(request);
        if (!Array.isArray(input.events)) return json(response, 400, { error: 'events must be an array' });
        run.sdkEvents.push(...input.events.map(validateDiagnosticEvent));
        return json(response, 200, { ok: true, accepted: input.events.length });
      }
      const stopMatch = route.match(/^\/runs\/([^/]+)\/stop$/);
      if (request.method === 'POST' && stopMatch) {
        const run = requireActiveRun(stopMatch[1]);
        const marker = await readJson(request);
        const completed = await persistRun(run, marker, resultsRoot);
        lastCompletedRun = completed;
        activeRun = undefined;
        configuredRun = undefined;
        return json(response, 200, { ok: true, ...completed });
      }
      if (request.method === 'GET' && route === '/status') {
        return json(response, 200, statusSnapshot(
          activeRun,
          configuredRun,
          lastCompletedRun,
          lastDataAt,
          dataRequestCount,
          dataBodyBytes,
        ));
      }
      return json(response, 404, { error: 'not found' });
    } catch (error) {
      return json(response, error?.statusCode || 500, { error: safeError(error) });
    }
  });

  function requireActiveRun(encodedRunId) {
    const runId = decodeURIComponent(encodedRunId);
    if (!activeRun || activeRun.config.runId !== runId) {
      const error = new Error('run is not active');
      error.statusCode = 409;
      throw error;
    }
    return activeRun;
  }

  return {
    async listen() {
      await mkdir(resultsRoot, { recursive: true });
      const [dataAddress, controlAddress] = await Promise.all([
        listen(dataServer, dataPort, host),
        listen(controlServer, controlPort, host),
      ]);
      return {
        dataPort: dataAddress.port,
        controlPort: controlAddress.port,
        host,
        resultsRoot,
      };
    },
    async close() {
      await Promise.all([close(dataServer), close(controlServer)]);
    },
  };
}

function statusSnapshot(activeRun, configuredRun, lastCompletedRun, lastDataAt, dataRequestCount, dataBodyBytes) {
  if (activeRun) {
    return {
      state: 'running',
      runId: activeRun.config.runId,
      measurementStartedAt: activeRun.measurementStartedAt,
      lastDataAt: activeRun.lastDataAt,
      quietForMs: activeRun.lastDataAt ? Date.now() - activeRun.lastDataAt : null,
      requestCount: activeRun.requests.length,
      bodyBytes: activeRun.bodyBytes,
      connectionBytes: activeRun.connectionBytes,
      sdkEventCount: activeRun.sdkEvents.length,
    };
  }
  if (configuredRun) {
    return {
      state: 'configured',
      runId: configuredRun.runId,
      lastDataAt,
      quietForMs: lastDataAt ? Date.now() - lastDataAt : null,
      requestCount: dataRequestCount,
      bodyBytes: dataBodyBytes,
    };
  }
  if (lastCompletedRun) return { state: 'completed', ...lastCompletedRun };
  return { state: 'idle' };
}

async function persistRun(run, marker, resultsRoot) {
  const measurementEndedAt = Date.now();
  const directory = path.join(resultsRoot, run.config.runId);
  await mkdir(directory, { recursive: false });
  const metadata = {
    ...run.config,
    measurementStartedAt: run.measurementStartedAt,
    measurementEndedAt,
    actualMeasurementMs: measurementEndedAt - run.measurementStartedAt,
    flushRequestedAt: finiteNumber(marker.flushRequestedAt),
    lastUploadAt: run.lastDataAt,
    flushWaitMs: finiteNumber(marker.flushWaitMs),
    completedAt: measurementEndedAt,
  };
  const requests = run.requests.map((request, index) => ({ sequence: index + 1, ...request }));
  const duplicateCounts = new Map();
  for (const request of requests) {
    if (request.bodyBytes === 0) continue;
    const key = `${request.method}\n${request.path}\n${request.bodySha256}`;
    duplicateCounts.set(key, (duplicateCounts.get(key) || 0) + 1);
  }
  const retryCount = [...duplicateCounts.values()].reduce((total, count) => total + Math.max(0, count - 1), 0);
  const httpStats = {
    requestCount: requests.length,
    retryCount,
    bodyBytes: run.bodyBytes,
    connectionBytes: run.connectionBytes,
    lastDataAt: run.lastDataAt,
    requests,
  };
  await Promise.all([
    writeJson(path.join(directory, 'metadata.json'), metadata),
    writeJson(path.join(directory, 'sdk-events.json'), run.sdkEvents),
    writeJson(path.join(directory, 'http.json'), httpStats),
  ]);
  return { runId: run.config.runId, resultDirectory: directory };
}

function validateDiagnosticEvent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badRequest('invalid SDK event');
  if (typeof value.type !== 'string' || !Number.isFinite(value.timestamp)) throw badRequest('invalid SDK event');
  return { ...value };
}

function replayCheckFiles(body, encodingHeader) {
  const decoded = decodeBody(body, headerValue(encodingHeader)?.toLowerCase());
  const value = JSON.parse(decoded.toString('utf8'));
  return Array.isArray(value?.files)
    ? value.files.filter((file) => typeof file === 'string' && file.length > 0)
    : [];
}

function decodeBody(body, encoding) {
  if (!encoding || encoding === 'identity') return body;
  if (encoding === 'gzip') return gunzipSync(body);
  if (encoding === 'deflate') return inflateSync(body);
  throw badRequest(`unsupported content encoding: ${encoding}`);
}

async function readJson(request) {
  const body = await readBody(request, MAX_CONTROL_BODY_BYTES);
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw badRequest('invalid JSON');
  }
}

async function readBody(request, maximumBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximumBytes) {
      const error = new Error('request body is too large');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

function safePath(url) {
  try {
    return new URL(url || '/', 'http://capture.local').pathname;
  } catch {
    return '/';
  }
}

function headerValue(value) {
  if (Array.isArray(value)) return value.join(', ');
  return typeof value === 'string' ? value : undefined;
}

function multipartSummary(body, contentType) {
  if (!contentType?.toLowerCase().startsWith('multipart/form-data')) return {};
  const match = contentType.match(/(?:^|;)\s*boundary=(?:"([^"]+)"|([^;\s]+))/i);
  const boundary = match?.[1] || match?.[2];
  if (!boundary || boundary.length > 200) return {};

  const delimiter = Buffer.from(`--${boundary}`);
  const nextDelimiter = Buffer.from(`\r\n--${boundary}`);
  const headerTerminator = Buffer.from('\r\n\r\n');
  let cursor = body.indexOf(delimiter);
  let multipartFileCount = 0;
  let multipartFileBytes = 0;
  let multipartFieldCount = 0;

  while (cursor >= 0) {
    cursor += delimiter.length;
    if (body.subarray(cursor, cursor + 2).equals(Buffer.from('--'))) break;
    if (body.subarray(cursor, cursor + 2).equals(Buffer.from('\r\n'))) cursor += 2;
    const headerEnd = body.indexOf(headerTerminator, cursor);
    if (headerEnd < 0) return {};
    const payloadStart = headerEnd + headerTerminator.length;
    const payloadEnd = body.indexOf(nextDelimiter, payloadStart);
    if (payloadEnd < 0) return {};
    const headers = body.subarray(cursor, headerEnd).toString('latin1');
    const disposition = headers.match(/^content-disposition:[^\r\n]*$/im)?.[0] || '';
    if (/;\s*filename\s*=/i.test(disposition)) {
      multipartFileCount += 1;
      multipartFileBytes += payloadEnd - payloadStart;
    } else {
      multipartFieldCount += 1;
    }
    cursor = payloadEnd + 2;
  }

  return {
    multipartFileCount,
    multipartFileBytes,
    multipartFieldCount,
    multipartOverheadBytes: body.length - multipartFileBytes,
  };
}

function badRequest(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function safeError(error) {
  return error instanceof Error ? error.message : 'unknown error';
}

function finiteNumber(value) {
  return Number.isFinite(value) ? value : undefined;
}

function numberOption(value, fallback) {
  const numeric = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(numeric) || numeric < 0 || numeric > 65535) {
    throw new RangeError('port must be an integer from 0 to 65535');
  }
  return numeric;
}

function json(response, statusCode, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(statusCode, {
    'content-type': 'application/json',
    'content-length': body.length,
    connection: 'keep-alive',
  });
  response.end(body);
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve(server.address());
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    if (!server.listening) return resolve();
    server.close((error) => error ? reject(error) : resolve());
  });
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
  const server = createReplayTrafficCaptureServer({
    host: readOption('--host', '0.0.0.0'),
    dataPort: readOption('--data-port', '19529'),
    controlPort: readOption('--control-port', '19530'),
    resultsRoot: readOption('--results-root', DEFAULT_RESULTS_ROOT),
  });
  const address = await server.listen();
  process.stdout.write(
    `[replay-traffic] data=:${address.dataPort} control=:${address.controlPort} results=${address.resultsRoot}\n`,
  );
  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
