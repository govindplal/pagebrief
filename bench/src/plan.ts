// Job planning for a benchmark run, kept pure so it can be tested.
//
// Jobs are ordered repeat-major and interleave tools: every task once for
// every tool, then the second repeat, and so on. If a run stops early (for
// example near the subscription's usage limit) the completed part is still a
// balanced comparison: same tasks, same number of repeats, for every tool.

export interface Job<T> {
  task: T;
  tool: string;
  rep: number;
}

export const jobKey = (tool: string, taskId: string, rep: number): string => `${tool}|${taskId}|${rep}`;

export function planJobs<T extends { id: string }>(
  tasks: T[],
  tools: string[],
  repeats: number,
  done: Set<string> = new Set(),
): Job<T>[] {
  const jobs: Job<T>[] = [];
  for (let rep = 1; rep <= repeats; rep++)
    for (const task of tasks)
      for (const tool of tools) if (!done.has(jobKey(tool, task.id, rep))) jobs.push({ task, tool, rep });
  return jobs;
}

/** Usage of the subscription's rolling limits, as reported by Claude Code's rate_limit_event. */
export interface RateLimit {
  status: string;
  fiveHour: number | null;
  sevenDay: number | null;
  resetsAt: number | null;
}

interface RateLimitInfo {
  status?: string;
  resetsAt?: number;
  utilization?: number;
  rateLimitType?: string;
  unifiedWindows?: Record<string, { utilization?: number; resetsAt?: number; status?: string }>;
}

export function parseRateLimit(info: RateLimitInfo): RateLimit {
  const w = info.unifiedWindows ?? {};
  const fiveHour = w.five_hour?.utilization ?? (info.rateLimitType === "five_hour" ? info.utilization : undefined);
  return {
    status: info.status ?? "unknown",
    fiveHour: fiveHour ?? null,
    sevenDay: w.seven_day?.utilization ?? null,
    resetsAt: w.five_hour?.resetsAt ?? info.resetsAt ?? null,
  };
}

/** Error text Claude Code prints when the subscription limit is hit. */
export const QUOTA_ERROR = /usage limit|rate limit|limit reached|limit will reset|out of extra usage/i;
