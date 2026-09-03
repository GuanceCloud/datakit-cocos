export interface ReplayTrafficCaptureServer {
  listen(): Promise<{ dataPort: number; controlPort: number; host: string; resultsRoot: string }>;
  close(): Promise<void>;
}

export function createReplayTrafficCaptureServer(options?: {
  host?: string;
  dataPort?: number;
  controlPort?: number;
  resultsRoot?: string;
}): ReplayTrafficCaptureServer;
