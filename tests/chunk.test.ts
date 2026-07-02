import { describe, it, expect } from "bun:test";
import { chunk } from "../src/format.ts";

describe("chunk", () => {
  it("splits evenly", () => {
    expect(chunk([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
  });

  it("last chunk smaller", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("size >= length returns single chunk", () => {
    expect(chunk([1, 2, 3], 10)).toEqual([[1, 2, 3]]);
  });

  it("size === 1 returns one item per chunk", () => {
    expect(chunk(["a", "b", "c"], 1)).toEqual([["a"], ["b"], ["c"]]);
  });

  it("empty array returns empty array", () => {
    expect(chunk([], 5)).toEqual([]);
  });

  it("size <= 0 returns single chunk", () => {
    expect(chunk([1, 2, 3], 0)).toEqual([[1, 2, 3]]);
  });
});
