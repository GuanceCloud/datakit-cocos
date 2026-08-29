import { mkdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

await mkdir('artifacts', { recursive: true });
const metadata = JSON.parse(await readFile('packages/cocos/package.json', 'utf8'));

const packResult = spawnSync(
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['pack', '--workspace', metadata.name, '--pack-destination', 'artifacts'],
  {
    stdio: 'inherit',
    env: { ...process.env, npm_config_cache: '/tmp/cocos-sdk-npm-cache' },
  },
);
if (packResult.status !== 0) process.exit(packResult.status || 1);

const zipResult = spawnSync(
  'zip',
  ['-qr', `../../artifacts/guance-cocos-${metadata.version}.zip`, '.'],
  { cwd: 'packages/cocos', stdio: 'inherit' },
);
if (zipResult.status !== 0) process.exit(zipResult.status || 1);
