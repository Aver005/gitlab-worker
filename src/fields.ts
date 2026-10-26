import {
  getAssignees,
  getDates,
  getDescription,
  getLabels,
  getStatus,
  getTimeTracking,
  getWeight,
  type WorkItemNode,
} from "./api.ts";
import { secondsToHuman } from "./format.ts";

export type FlatValue = string | number | string[] | null;

const FIELDS: Record<string, (item: WorkItemNode) => FlatValue> = {
  iid: (i) => i.iid,
  id: (i) => i.id,
  title: (i) => i.title,
  state: (i) => i.state.toLowerCase(),
  status: (i) => getStatus(i)?.name ?? null,
  labels: (i) => getLabels(i).map((l) => l.title),
  assignees: (i) => getAssignees(i).map((a) => a.username),
  weight: (i) => getWeight(i),
  start: (i) => getDates(i).startDate,
  due: (i) => getDates(i).dueDate,
  estimate: (i) => getTimeTracking(i).timeEstimate,
  spent: (i) => getTimeTracking(i).totalTimeSpent,
  project: (i) => i.namespace?.fullPath ?? null,
  url: (i) => i.webUrl,
  description: (i) => getDescription(i),
};

const DURATION_FIELDS = new Set(["estimate", "spent"]);

export const FIELD_NAMES = Object.keys(FIELDS);

/** "iid, Title,labels" → ["iid", "title", "labels"]; throws on unknown names. */
export function parseFields(csv: string): string[] {
  const names = [...new Set(csv.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean))];
  const unknown = names.filter((n) => !(n in FIELDS));
  if (unknown.length > 0) {
    throw new Error(`Unknown field(s): ${unknown.join(", ")}. Available: ${FIELD_NAMES.join(", ")}`);
  }
  if (names.length === 0) throw new Error(`--fields is empty. Available: ${FIELD_NAMES.join(", ")}`);
  return names;
}

/** estimate/spent stay in seconds so JSON consumers can sum them. */
export function flattenItem(item: WorkItemNode, fields: string[]): Record<string, FlatValue> {
  return Object.fromEntries(fields.map((f) => [f, FIELDS[f]!(item)]));
}

export function fieldText(field: string, value: FlatValue): string {
  if (value === null) return "-";
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "-";
  if (DURATION_FIELDS.has(field)) return value ? secondsToHuman(Number(value)) : "-";
  const s = String(value).replace(/\s*\n\s*/g, " ").trim();
  return s || "-";
}

/** Header plus one line per row, columns padded to the widest value. */
export function formatFieldTable(rows: Array<Record<string, FlatValue>>, fields: string[]): string[] {
  const cells = [
    fields.map((f) => f.toUpperCase()),
    ...rows.map((r) => fields.map((f) => fieldText(f, r[f] ?? null))),
  ];
  const widths = fields.map((_, c) => Math.max(...cells.map((row) => row[c]!.length)));
  return cells.map((row) =>
    row.map((cell, c) => (c === row.length - 1 ? cell : cell.padEnd(widths[c]!))).join("  ")
  );
}
