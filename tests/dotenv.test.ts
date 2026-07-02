import { describe, it, expect } from "bun:test";
import { parseDotEnv } from "../src/config.ts";

describe("parseDotEnv", () => {
  it("parses simple key=value", () => {
    expect(parseDotEnv("FOO=bar")).toEqual({ FOO: "bar" });
  });

  it("ignores blank lines and comments", () => {
    const content = `
# comment
FOO=bar

BAZ=qux
`;
    expect(parseDotEnv(content)).toEqual({ FOO: "bar", BAZ: "qux" });
  });

  it("strips surrounding double quotes", () => {
    expect(parseDotEnv(`TOKEN="glpat-abc123"`)).toEqual({ TOKEN: "glpat-abc123" });
  });

  it("strips surrounding single quotes", () => {
    expect(parseDotEnv(`TOKEN='glpat-abc123'`)).toEqual({ TOKEN: "glpat-abc123" });
  });

  it("strips export prefix", () => {
    expect(parseDotEnv(`export GITLAB_TOKEN=mytoken`)).toEqual({ GITLAB_TOKEN: "mytoken" });
  });

  it("export with quotes", () => {
    expect(parseDotEnv(`export GITLAB_URL="https://git.example.com"`)).toEqual({
      GITLAB_URL: "https://git.example.com",
    });
  });

  it("handles CRLF line endings", () => {
    expect(parseDotEnv("A=1\r\nB=2\r\n")).toEqual({ A: "1", B: "2" });
  });

  it("handles value with = sign", () => {
    expect(parseDotEnv("URL=https://example.com/path?foo=bar")).toEqual({
      URL: "https://example.com/path?foo=bar",
    });
  });

  it("ignores lines without =", () => {
    expect(parseDotEnv("NOEQUALS\nFOO=bar")).toEqual({ FOO: "bar" });
  });

  it("trims key and value whitespace", () => {
    expect(parseDotEnv("  FOO  =  bar  ")).toEqual({ FOO: "bar" });
  });

  it("empty content returns empty object", () => {
    expect(parseDotEnv("")).toEqual({});
  });
});
