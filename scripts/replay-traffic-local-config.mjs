import path from 'node:path';

/** Resolve machine-local native SDK paths without committing user-specific locations. */
export function resolveNativeSdkRoot({ platform, workspaceRoot, optionValue, environment = process.env }) {
  if (platform !== 'android' && platform !== 'ios') {
    throw new TypeError('platform must be android or ios');
  }
  const variable = platform === 'android'
    ? 'REPLAY_TRAFFIC_ANDROID_SDK_ROOT'
    : 'REPLAY_TRAFFIC_IOS_SDK_ROOT';
  const configured = clean(optionValue) || clean(environment[variable]);
  return configured
    ? path.resolve(workspaceRoot, configured)
    : path.resolve(workspaceRoot, '..', `ft-sdk-${platform}`);
}

function clean(value) {
  return typeof value === 'string' ? value.trim() : '';
}
