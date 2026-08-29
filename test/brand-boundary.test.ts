import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const brandNeutralTargets = [
  'src',
  'examples/creator2',
  'examples/creator3',
  'examples/creator2-app/assets/Script',
  'native/android/src',
  'native/ios/FTCocosBridge.h',
  'native/ios/FTCocosBridge.m',
  'scripts/configure-sample.mjs',
];

const distributionTargets = [
  'installer/cli.cjs',
  'integrations/creator2',
  'integrations/creator3',
  'integrations/shared/install-native.cjs',
  'scripts/pack.mjs',
];

const requiredDistributionIdentifiers = [
  'guance-cocos-sdk',
  'guance-cocos',
  'mvnrepo.guance.com',
];

describe('shared-code brand boundary', () => {
  it('keeps runtime and Sample source brand-neutral', () => {
    expect(findBrandReferences(brandNeutralTargets, ['guanceSdk'])).toEqual([]);
  });

  it('limits distribution code to required package and repository identifiers', () => {
    expect(findBrandReferences(distributionTargets, requiredDistributionIdentifiers)).toEqual([]);
  });
});

function findBrandReferences(targets: string[], allowed: string[] = []): string[] {
  const references: string[] = [];
  for (const file of targets.flatMap(collectFiles)) {
    let source = readFileSync(file, 'utf8');
    for (const identifier of allowed) source = source.split(identifier).join('');
    if (/guance/i.test(source)) references.push(file);
  }
  return references;
}

function collectFiles(target: string): string[] {
  if (!statSync(target).isDirectory()) return [target];
  return readdirSync(target).flatMap((entry) => collectFiles(join(target, entry)));
}
