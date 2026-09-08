import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const brandNeutralTargets = [
  'src',
  'native/android/src',
  'native/ios/FTCocosBridge.h',
  'native/ios/FTCocosBridge.m',
  'scripts/configure-sample.mjs',
];

const sampleTargets = [
  'examples/hybrid-creator2/assets/Script/HybridTelemetrySample.ts',
  'examples/hybrid-creator3/assets/HybridTelemetrySample.ts',
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
    // The runnable samples display the product name in their page title.
    expect(findBrandReferences(sampleTargets, ['guanceSdk', 'Guance Cocos Hybrid'])).toEqual([]);
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
