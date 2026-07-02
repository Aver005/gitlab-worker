// Terminal output helpers

const useColor =
  !process.env["NO_COLOR"] &&
  process.stdout.isTTY;

function c(code: number, text: string): string {
  if (!useColor) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

export const bold = (t: string) => c(1, t);
export const dim = (t: string) => c(2, t);
export const green = (t: string) => c(32, t);
export const yellow = (t: string) => c(33, t);
export const cyan = (t: string) => c(36, t);
export const red = (t: string) => c(31, t);
export const magenta = (t: string) => c(35, t);

/**
 * Format seconds into a human-readable duration string.
 * Examples: 7200 → "2h", 5400 → "1h 30m", 3600 → "1h", 90 → "1m"
 */
export function secondsToHuman(seconds: number): string {
  if (seconds === 0) return "0";
  const weeks = Math.floor(seconds / (5 * 8 * 3600)); // 5 working days, 8h each
  seconds -= weeks * 5 * 8 * 3600;
  const days = Math.floor(seconds / (8 * 3600));
  seconds -= days * 8 * 3600;
  const hours = Math.floor(seconds / 3600);
  seconds -= hours * 3600;
  const minutes = Math.floor(seconds / 60);

  const parts: string[] = [];
  if (weeks) parts.push(`${weeks}w`);
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  return parts.join(" ") || "0";
}

/** GraphQL returns "OPEN"/"CLOSED"; REST-style strings are "opened"/"closed". */
export function isOpenState(state: string): boolean {
  const s = state.toLowerCase();
  return s === "open" || s === "opened";
}

export interface IssueSummary {
  iid: number | string;
  state: string;
  title: string;
  labels?: string[];
  assignee?: string;
}

/**
 * Format a single issue line: #12 [opened] title (labels) @assignee
 */
export function formatIssueLine(issue: IssueSummary): string {
  const iid = cyan(`#${issue.iid}`);
  const stateLabel = issue.state.toLowerCase();
  const state = isOpenState(issue.state)
    ? green(`[${stateLabel}]`)
    : dim(`[${stateLabel}]`);
  const title = bold(issue.title);
  const labels =
    issue.labels && issue.labels.length > 0
      ? dim(`(${issue.labels.join(", ")})`)
      : "";
  const assignee = issue.assignee ? magenta(`@${issue.assignee}`) : "";

  return [iid, state, title, labels, assignee].filter(Boolean).join(" ");
}

/**
 * Split an array into chunks of at most `size` elements.
 * Pure helper — no side effects.
 */
export function chunk<T>(arr: T[], size: number): T[][] {
  if (size <= 0) return [arr];
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

/**
 * Print a key-value table, padding keys to align values.
 */
export function printTable(rows: Array<[string, string]>): void {
  const maxKey = Math.max(...rows.map(([k]) => k.length));
  for (const [key, value] of rows) {
    const paddedKey = key.padEnd(maxKey);
    console.log(`  ${dim(paddedKey)}  ${value}`);
  }
}
