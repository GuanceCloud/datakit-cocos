export interface ReplayTrafficLocalConfigInput {
  platform: 'android' | 'ios';
  workspaceRoot: string;
  optionValue?: string;
  environment?: Record<string, string | undefined>;
}

export function resolveNativeSdkRoot(input: ReplayTrafficLocalConfigInput): string;
