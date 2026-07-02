import { describe, it, expect } from "bun:test";
import { secondsToHuman, formatIssueLine } from "../src/format.ts";

describe("secondsToHuman", () => {
  it("returns 0 for zero seconds", () => {
    expect(secondsToHuman(0)).toBe("0");
  });

  it("converts 7200 seconds to 2h", () => {
    expect(secondsToHuman(7200)).toBe("2h");
  });

  it("converts 5400 seconds to 1h 30m", () => {
    expect(secondsToHuman(5400)).toBe("1h 30m");
  });

  it("converts 3600 seconds to 1h", () => {
    expect(secondsToHuman(3600)).toBe("1h");
  });

  it("converts 1800 seconds to 30m", () => {
    expect(secondsToHuman(1800)).toBe("30m");
  });

  it("converts 60 seconds to 1m", () => {
    expect(secondsToHuman(60)).toBe("1m");
  });

  it("converts 1 working day (8h = 28800s) to 1d", () => {
    expect(secondsToHuman(28800)).toBe("1d");
  });

  it("converts 1 working week (5d x 8h = 144000s) to 1w", () => {
    expect(secondsToHuman(144000)).toBe("1w");
  });

  it("handles hours and minutes together", () => {
    expect(secondsToHuman(9000)).toBe("2h 30m");
  });

  it("handles days and hours together", () => {
    expect(secondsToHuman(32400)).toBe("1d 1h");
  });
});

describe("formatIssueLine", () => {
  // Since format output depends on TTY detection (colors), we check structure
  // by checking that key pieces appear in the output string

  it("includes iid and title", () => {
    const line = formatIssueLine({ iid: 42, state: "opened", title: "Fix the bug" });
    expect(line).toContain("42");
    expect(line).toContain("Fix the bug");
  });

  it("includes state", () => {
    const line = formatIssueLine({ iid: 1, state: "closed", title: "Done" });
    expect(line).toContain("closed");
  });

  it("includes labels when provided", () => {
    const line = formatIssueLine({
      iid: 5,
      state: "opened",
      title: "T",
      labels: ["bug", "v2"],
    });
    expect(line).toContain("bug");
    expect(line).toContain("v2");
  });

  it("includes assignee when provided", () => {
    const line = formatIssueLine({
      iid: 7,
      state: "opened",
      title: "T",
      assignee: "alice",
    });
    expect(line).toContain("alice");
  });

  it("omits labels section when labels array is empty", () => {
    const line = formatIssueLine({
      iid: 3,
      state: "opened",
      title: "No Labels",
      labels: [],
    });
    // Should not contain parentheses for empty labels
    expect(line).not.toContain("()");
  });

  it("omits assignee when not provided", () => {
    const line = formatIssueLine({ iid: 8, state: "opened", title: "No Assignee" });
    expect(line).not.toContain("@");
  });
});
