import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { homedir } from "node:os";
import { globalDir } from "../src/config.ts";

describe("globalDir", () => {
  test("uses APPDATA when set (Windows)", () => {
    const dir = globalDir({ APPDATA: "C:\\Users\\alice\\AppData\\Roaming" });
    expect(dir).toBe(join("C:\\Users\\alice\\AppData\\Roaming", "glw"));
  });

  test("falls back to ~/.config/glw without APPDATA (POSIX)", () => {
    const dir = globalDir({});
    expect(dir).toBe(join(homedir(), ".config", "glw"));
  });

  test("empty APPDATA string falls back too", () => {
    const dir = globalDir({ APPDATA: "" });
    expect(dir).toBe(join(homedir(), ".config", "glw"));
  });
});
