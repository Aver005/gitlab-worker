import { describe, it, expect } from "bun:test";
import { parseLinkType, normalizeIid } from "../src/api.ts";

describe("parseLinkType", () => {
  it("maps related spellings to RELATED", () => {
    expect(parseLinkType("related")).toBe("RELATED");
    expect(parseLinkType("relates")).toBe("RELATED");
    expect(parseLinkType("rel")).toBe("RELATED");
  });

  it("maps blocks spellings to BLOCKS", () => {
    expect(parseLinkType("blocks")).toBe("BLOCKS");
    expect(parseLinkType("block")).toBe("BLOCKS");
    expect(parseLinkType("blocking")).toBe("BLOCKS");
  });

  it("maps blocked-by spellings to BLOCKED_BY", () => {
    expect(parseLinkType("blocked-by")).toBe("BLOCKED_BY");
    expect(parseLinkType("blocked_by")).toBe("BLOCKED_BY");
    expect(parseLinkType("blockedby")).toBe("BLOCKED_BY");
    expect(parseLinkType("is-blocked-by")).toBe("BLOCKED_BY");
  });

  it("is case-insensitive and tolerates whitespace/underscores", () => {
    expect(parseLinkType("  RELATED  ")).toBe("RELATED");
    expect(parseLinkType("Blocked By")).toBe("BLOCKED_BY");
    expect(parseLinkType("BLOCKS")).toBe("BLOCKS");
  });

  it("throws on an unknown link type", () => {
    expect(() => parseLinkType("duplicates")).toThrow(/Invalid link type/);
    expect(() => parseLinkType("")).toThrow(/Invalid link type/);
  });
});

describe("normalizeIid", () => {
  it("returns plain numeric strings unchanged", () => {
    expect(normalizeIid("42")).toBe("42");
    expect(normalizeIid("1")).toBe("1");
  });

  it("strips a leading # and surrounding whitespace", () => {
    expect(normalizeIid("#42")).toBe("42");
    expect(normalizeIid("  #7 ")).toBe("7");
    expect(normalizeIid(" 13 ")).toBe("13");
  });

  it("throws on non-numeric input", () => {
    expect(() => normalizeIid("abc")).toThrow(/Invalid issue number/);
    expect(() => normalizeIid("42a")).toThrow(/Invalid issue number/);
    expect(() => normalizeIid("#")).toThrow(/Invalid issue number/);
    expect(() => normalizeIid("")).toThrow(/Invalid issue number/);
  });
});
