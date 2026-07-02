import { describe, expect, test } from "bun:test";
import { pickProject, type ProjectInfo } from "../src/api.ts";

const projects: ProjectInfo[] = [
  { id: "1", fullPath: "acme/internal/backend-api", name: "Backend API" },
  { id: "2", fullPath: "acme/internal/backend-jobs", name: "Backend Jobs" },
  { id: "3", fullPath: "acme/tools/deploy", name: "Deploy Tools" },
  { id: "4", fullPath: "sandbox/deploy", name: "Deploy Sandbox" },
];

describe("pickProject", () => {
  test("exact fullPath wins", () => {
    const r = pickProject(projects, "sandbox/deploy");
    expect(r.match?.id).toBe("4");
  });

  test("exact name, case-insensitive", () => {
    const r = pickProject(projects, "backend api");
    expect(r.match?.id).toBe("1");
  });

  test("exact last path segment", () => {
    const r = pickProject(projects, "backend-jobs");
    expect(r.match?.id).toBe("2");
  });

  test("unique substring", () => {
    const r = pickProject(projects, "api");
    expect(r.match?.id).toBe("1");
  });

  test("ambiguous substring returns candidates", () => {
    const r = pickProject(projects, "backend");
    expect(r.match).toBeUndefined();
    expect(r.ambiguous?.length).toBe(2);
  });

  test("ambiguous last segment falls back to ambiguous list", () => {
    const r = pickProject(projects, "deploy");
    expect(r.match).toBeUndefined();
    expect(r.ambiguous?.length).toBe(2);
  });

  test("no match", () => {
    const r = pickProject(projects, "nonexistent");
    expect(r.match).toBeUndefined();
    expect(r.ambiguous).toBeUndefined();
  });
});
