import { describe, it, expect } from "bun:test";
import { matchesSearch } from "../src/api.ts";

type Item = { title: string; description: string; startDate: string | null };

const make = (overrides: Partial<Item> = {}): Item => ({
  title: "Default title",
  description: "Default description body",
  startDate: null,
  ...overrides,
});

describe("matchesSearch", () => {
  it("returns true with empty criteria", () => {
    expect(matchesSearch(make(), {})).toBe(true);
  });

  it("text: matches title (case-insensitive)", () => {
    const item = make({ title: "Auth module refactor", description: "" });
    expect(matchesSearch(item, { text: "auth" })).toBe(true);
    expect(matchesSearch(item, { text: "AUTH" })).toBe(true);
  });

  it("text: matches description", () => {
    const item = make({ title: "Some title", description: "JWT token handling" });
    expect(matchesSearch(item, { text: "jwt" })).toBe(true);
  });

  it("text: misses when neither title nor description match", () => {
    const item = make({ title: "Alpha", description: "Beta" });
    expect(matchesSearch(item, { text: "gamma" })).toBe(false);
  });

  it("name: filters by title", () => {
    const item = make({ title: "Fix login bug", description: "Details here" });
    expect(matchesSearch(item, { name: "login" })).toBe(true);
    expect(matchesSearch(item, { name: "payment" })).toBe(false);
  });

  it("body: filters by description", () => {
    const item = make({ title: "Task", description: "Refactor the controller layer" });
    expect(matchesSearch(item, { body: "controller" })).toBe(true);
    expect(matchesSearch(item, { body: "service" })).toBe(false);
  });

  it("startTime: requires startDate to be set and >= threshold", () => {
    const item = make({ startDate: "2026-03-15" });
    expect(matchesSearch(item, { startTime: "2026-01-01" })).toBe(true);
    expect(matchesSearch(item, { startTime: "2026-03-15" })).toBe(true);
    expect(matchesSearch(item, { startTime: "2026-06-01" })).toBe(false);
  });

  it("startTime: fails when startDate is null", () => {
    const item = make({ startDate: null });
    expect(matchesSearch(item, { startTime: "2026-01-01" })).toBe(false);
  });

  it("all criteria must match (AND logic)", () => {
    const item = make({
      title: "Auth refactor",
      description: "JWT implementation details",
      startDate: "2026-05-01",
    });
    expect(matchesSearch(item, { name: "auth", body: "jwt", startTime: "2026-04-01" })).toBe(true);
    expect(matchesSearch(item, { name: "auth", body: "oauth" })).toBe(false);
  });

  it("text + name are both ANDed when given", () => {
    const item = make({ title: "Auth module", description: "Handles authentication" });
    expect(matchesSearch(item, { text: "auth", name: "module" })).toBe(true);
    expect(matchesSearch(item, { text: "auth", name: "payment" })).toBe(false);
  });
});
