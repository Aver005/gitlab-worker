import { describe, it, expect } from "bun:test";
import { parseFields, flattenItem, fieldText, formatFieldTable } from "../src/fields.ts";
import type { WorkItemNode } from "../src/api.ts";

const item = {
  id: "gid://gitlab/WorkItem/1",
  iid: "42",
  title: "Login page",
  state: "OPEN",
  webUrl: "https://gitlab.example.com/acme/app/-/work_items/42",
  widgets: [
    { type: "DESCRIPTION", description: "line one\nline two" },
    { type: "LABELS", labels: { nodes: [{ id: "l1", title: "bug" }, { id: "l2", title: "type::ui" }] } },
    { type: "ASSIGNEES", assignees: { nodes: [{ id: "u1", username: "alice", name: "Alice" }] } },
    { type: "STATUS", status: { id: "s1", name: "In progress" } },
    { type: "WEIGHT", weight: 3 },
    { type: "START_AND_DUE_DATE", startDate: "2026-10-01", dueDate: null },
    { type: "TIME_TRACKING", timeEstimate: 7200, totalTimeSpent: 0 },
  ],
} as WorkItemNode;

describe("parseFields", () => {
  it("trims, lowercases and dedupes", () => {
    expect(parseFields(" iid, Title ,iid,labels")).toEqual(["iid", "title", "labels"]);
  });

  it("rejects unknown and empty lists", () => {
    expect(() => parseFields("iid,colour")).toThrow(/Unknown field\(s\): colour/);
    expect(() => parseFields(" , ")).toThrow(/empty/);
  });
});

describe("flattenItem", () => {
  it("pulls values out of widgets", () => {
    expect(
      flattenItem(item, ["iid", "state", "status", "labels", "assignees", "weight", "start", "due", "estimate", "spent"])
    ).toEqual({
      iid: "42",
      state: "open",
      status: "In progress",
      labels: ["bug", "type::ui"],
      assignees: ["alice"],
      weight: 3,
      start: "2026-10-01",
      due: null,
      estimate: 7200,
      spent: 0,
    });
  });

  it("returns empty values when widgets are missing", () => {
    const bare = { ...item, widgets: [] } as WorkItemNode;
    expect(flattenItem(bare, ["status", "labels", "weight", "description"])).toEqual({
      status: null,
      labels: [],
      weight: null,
      description: "",
    });
  });
});

describe("fieldText", () => {
  it("renders durations, arrays, nulls and multi-line text", () => {
    expect(fieldText("estimate", 5400)).toBe("1h 30m");
    expect(fieldText("spent", 0)).toBe("-");
    expect(fieldText("labels", ["a", "b"])).toBe("a, b");
    expect(fieldText("labels", [])).toBe("-");
    expect(fieldText("due", null)).toBe("-");
    expect(fieldText("description", "one\n\n  two")).toBe("one two");
    expect(fieldText("weight", 0)).toBe("0");
  });
});

describe("formatFieldTable", () => {
  it("pads every column but the last", () => {
    const rows = [
      { iid: "7", title: "Short" },
      { iid: "1234", title: "Longer title" },
    ];
    expect(formatFieldTable(rows, ["iid", "title"])).toEqual([
      "IID   TITLE",
      "7     Short",
      "1234  Longer title",
    ]);
  });
});
