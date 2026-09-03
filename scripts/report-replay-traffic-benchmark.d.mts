export function reportReplayTrafficBenchmark(options?: {
  resultsRoot?: string;
  outputDirectory?: string;
}): Promise<{ resultsRoot: string; outputDirectory: string; runs: any[]; groups: any[] }>;

export function analyzeReplayTrafficRun(run: any): any;
export function aggregateReplayTrafficRuns(rows: any[]): any[];
