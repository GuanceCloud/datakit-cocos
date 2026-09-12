import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { planRelease, publishInOrder, validateManifests, validatePackedPackage, getRegistryDocument, verifyPublishedPackage } from './publish-npm-token.mjs';

const baseName = '@cloudcare/cocos-sdk';
const replayName = '@cloudcare/cocos-session-replay';
const version = '0.1.0-alpha.6';
function manifests() {
  return [baseName, replayName].map((name, index) => ({
    name, version, publishConfig: { access: 'public' },
    repository: { url: 'git+https://github.com/GuanceCloud/datakit-cocos.git' },
    exports: { './creator2': './dist/creator2.js', './creator3': './dist/creator3.js' },
    ...(index ? { peerDependencies: { [baseName]: version } } : {}),
  }));
}
function artifacts() {
  return [baseName, replayName].map(name => ({ name, version, integrity: `sha512-${name}` }));
}
function document(artifact) {
  return { name: artifact.name, versions: { [artifact.version]: { dist: { integrity: artifact.integrity } } },
    'dist-tags': { latest: artifact.version } };
}

test('functional pair requires coordinated versions and exact non-optional peer', () => {
  assert.equal(validateManifests({ version }, manifests()), version);
  const pair = manifests();
  pair[1].peerDependencies[baseName] = `^${version}`;
  assert.throws(() => validateManifests({ version }, pair), /exact peer/);
  pair[1].peerDependencies[baseName] = version;
  pair[1].version = '0.1.0-alpha.7';
  assert.throws(() => validateManifests({ version }, pair), /Version mismatch/);
});

test('bootstrap or reverse dependency cannot pass release preflight', () => {
  assert.throws(() => validateManifests({ version: '0.0.0-bootstrap.0' }, manifests()), /Unsupported release/);
  const pair = manifests();
  pair[0].optionalDependencies = { [replayName]: version };
  assert.throws(() => validateManifests({ version }, pair), /must not depend/);
});

test('new Replay package inherits the same policy channel as the release pair', () => {
  const base = { name: baseName, versions: { '0.1.0': {} }, 'dist-tags': { latest: '0.1.0' } };
  const result = planRelease(artifacts(), [base, null]);
  assert.deepEqual(result.map(item => item.tag), ['alpha', 'alpha']);
  assert.deepEqual(result.map(item => item.skip), [false, false]);
});

test('retry skips only identical content, and catches conflicts before publishing', () => {
  const packed = artifacts();
  assert.deepEqual(planRelease(packed, [document(packed[0]), null]).map(item => item.skip), [true, false]);
  const conflict = document(packed[1]);
  conflict.versions[version].dist.integrity = 'sha512-different';
  assert.throws(() => planRelease(packed, [null, conflict]), /different content/);
  const movedTag = document(packed[0]);
  movedTag['dist-tags'].latest = '0.1.0-alpha.7';
  assert.throws(() => planRelease(packed, [movedTag, null]), /newer version/);
});

test('a new publication cannot move an existing prerelease channel backwards', () => {
  const base = { name: baseName, versions: { '0.1.0': {}, '0.1.0-alpha.7': {} },
    'dist-tags': { latest: '0.1.0', alpha: '0.1.0-alpha.7' } };
  assert.throws(() => planRelease(artifacts(), [base, null]), /refusing to move alpha/);
});

test('base must be published and verified before Replay, including partial retries', async () => {
  const events = [];
  const packed = artifacts();
  await publishInOrder(packed, async item => events.push(`publish ${item.name}`), async item => events.push(`verify ${item.name}`));
  assert.deepEqual(events, [`publish ${baseName}`, `verify ${baseName}`, `publish ${replayName}`, `verify ${replayName}`]);
  events.length = 0;
  await publishInOrder([{ ...packed[0], skip: true }, packed[1]], async item => events.push(`publish ${item.name}`), async item => events.push(`verify ${item.name}`));
  assert.deepEqual(events, [`verify ${baseName}`, `publish ${replayName}`, `verify ${replayName}`]);
});

test('base failure or failed verification stops before Replay publication', async () => {
  for (const failPublish of [true, false]) {
    const published = [];
    await assert.rejects(publishInOrder(artifacts(), async item => {
      published.push(item.name);
      if (failPublish) throw new Error('publish failed');
    }, async () => { throw new Error('verification failed'); }), /failed/);
    assert.deepEqual(published, [baseName]);
  }
});

test('packed exports must exist and base cannot retain Replay assets or credentials', () => {
  const manifest = manifests()[0];
  const packed = { name: baseName, version, files: [
    'dist/creator2.js', 'dist/creator3.js', 'creator2/package.json', 'creator3/package.json',
    'LICENSE', 'README.md', 'native/ios/FTCocosBridge.m',
  ].map(path => ({ path })) };
  validatePackedPackage(packed, manifest, false);
  packed.files.push({ path: 'native/shared/FTReplayFileWorker.h' });
  assert.throws(() => validatePackedPackage(packed, manifest, false), /Replay implementation/);
  packed.files.pop();
  packed.files.push({ path: '.npmrc' });
  assert.throws(() => validatePackedPackage(packed, manifest, false), /private\/configuration/);
});


test('registry reads bypass shared CDN cache on every request', async () => {
  const urls = [];
  const fetcher = async (url, options) => {
    urls.push(new URL(url));
    assert.equal(options.cache, 'no-store');
    return { ok: true, status: 200, json: async () => ({ name: baseName }) };
  };
  await getRegistryDocument(baseName, fetcher);
  await getRegistryDocument(baseName, fetcher);
  assert.equal(decodeURIComponent(urls[0].pathname), `/${baseName}`);
  assert.ok(urls[0].searchParams.get('release_check'));
  assert.notEqual(urls[0].search, urls[1].search);
});

function publication() {
  const bytes = Buffer.from('inspected release tarball');
  const plan = { ...artifacts()[0], tag: 'latest',
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` };
  const published = document(plan);
  published.versions[version].dist.tarball = 'https://registry.npmjs.org/@cloudcare/cocos-sdk/-/cocos-sdk-0.1.0-alpha.6.tgz';
  return { bytes, plan, published };
}

test('verification waits for version, integrity and tag propagation before downloading', async () => {
  const { bytes, plan, published } = publication();
  const missingIntegrity = structuredClone(published);
  delete missingIntegrity.versions[version].dist.integrity;
  const staleTag = structuredClone(published);
  staleTag['dist-tags'].latest = '0.1.0-alpha.5';
  const snapshots = [null, missingIntegrity, staleTag, published];
  let waits = 0;
  let downloads = 0;
  await verifyPublishedPackage(plan, {
    getDocument: async () => snapshots.shift(),
    wait: async () => { waits++; },
    download: async () => { downloads++; return bytes; },
  });
  assert.equal(waits, 3);
  assert.equal(downloads, 1);
  assert.equal(snapshots.length, 0);
});

test('verification timeout distinguishes unavailable metadata from an integrity conflict', async () => {
  const { plan, published } = publication();
  published.versions[version].dist.integrity = 'sha512-different';
  for (const [snapshot, reason] of [[null, /not exposed the published version/], [published, /integrity metadata/]]) {
    let reads = 0;
    let waits = 0;
    await assert.rejects(verifyPublishedPackage(plan, {
      attempts: 3, getDocument: async () => { reads++; return snapshot; },
      wait: async () => { waits++; },
      download: async () => { assert.fail('Unverified metadata must not proceed to download'); },
    }), reason);
    assert.equal(reads, 3);
    assert.equal(waits, 2);
  }
});

test('matching metadata still requires the downloaded tarball to match', async () => {
  const { plan, published } = publication();
  await assert.rejects(verifyPublishedPackage(plan, {
    getDocument: async () => published,
    download: async () => Buffer.from('different content'),
  }), /Downloaded tarball differs/);
});

test('partial release verifies the existing base before publishing Replay', async () => {
  const { bytes, plan, published } = publication();
  const replay = { ...artifacts()[1], tag: 'latest' };
  const plans = planRelease([plan, replay], [published, null]);
  const events = [];
  await publishInOrder(plans, async item => { events.push(`publish ${item.name}`); }, async item => {
    if (item.name === baseName) await verifyPublishedPackage(item, {
      getDocument: async () => published, download: async () => bytes,
    });
    events.push(`verified ${item.name}`);
  });
  assert.deepEqual(events, [`verified ${baseName}`, `publish ${replayName}`, `verified ${replayName}`]);
});
