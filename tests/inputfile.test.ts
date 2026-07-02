import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { parseIssueFile } from "../src/inputfile.ts";
import { writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

const TMP = join(import.meta.dir, "__tmp__");

beforeAll(() => {
  mkdirSync(TMP, { recursive: true });
});

afterAll(() => {
  if (existsSync(TMP)) rmSync(TMP, { recursive: true });
});

function write(name: string, content: string): string {
  const p = join(TMP, name);
  writeFileSync(p, content);
  return p;
}

// ─── Markdown tests ───────────────────────────────────────────────────────────

describe("parseIssueFile — markdown with frontmatter", () => {
  it("parses all recognized frontmatter fields", () => {
    const f = write(
      "full.md",
      `---
title: My Issue
labels: bug, feature
assignee: johndoe
weight: 5
estimate: 2h
start: 2026-07-01
due: 2026-07-31
status: In progress
confidential: true
type: Task
---
Body content here.
`
    );
    const result = parseIssueFile(f);
    expect(result.title).toBe("My Issue");
    expect(result.labels).toEqual(["bug", "feature"]);
    expect(result.assignees).toEqual(["johndoe"]);
    expect(result.weight).toBe(5);
    expect(result.estimate).toBe("2h");
    expect(result.start).toBe("2026-07-01");
    expect(result.due).toBe("2026-07-31");
    expect(result.status).toBe("In progress");
    expect(result.confidential).toBe(true);
    expect(result.type).toBe("Task");
    expect(result.description).toBe("Body content here.");
  });

  it("uses # H1 as title when no frontmatter title", () => {
    const f = write(
      "h1title.md",
      `---
labels: bug
---
# This Is The Title

Some description content.
`
    );
    const result = parseIssueFile(f);
    expect(result.title).toBe("This Is The Title");
    expect(result.labels).toEqual(["bug"]);
    expect(result.description).toBe("Some description content.");
  });

  it("handles inline array labels in frontmatter", () => {
    const f = write(
      "inline-array.md",
      `---
title: Test
labels: [alpha, beta, gamma]
---
desc
`
    );
    const result = parseIssueFile(f);
    expect(result.labels).toEqual(["alpha", "beta", "gamma"]);
  });

  it("handles quoted string values", () => {
    const f = write(
      "quoted.md",
      `---
title: "Quoted Title"
status: 'To do'
---
`
    );
    const result = parseIssueFile(f);
    expect(result.title).toBe("Quoted Title");
    expect(result.status).toBe("To do");
  });

  it("returns description as undefined when body is empty", () => {
    const f = write(
      "empty-body.md",
      `---
title: No Body
---
`
    );
    const result = parseIssueFile(f);
    expect(result.title).toBe("No Body");
    expect(result.description).toBeUndefined();
  });

  it("no frontmatter — uses H1 as title", () => {
    const f = write(
      "no-fm.md",
      `# Simple Title

Just a description.
`
    );
    const result = parseIssueFile(f);
    expect(result.title).toBe("Simple Title");
    expect(result.description).toBe("Just a description.");
  });
});

// ─── GitLab issue-template edge case ─────────────────────────────────────────

describe("parseIssueFile — GitLab issue-template frontmatter (edge case)", () => {
  it("treats unrecognized frontmatter as body (GitLab template metadata)", () => {
    // This simulates a GitLab issue template that starts with ---name:...\n---
    // which should NOT be treated as glw frontmatter
    const f = write(
      "gitlab-template.md",
      `---
name: Bug Report
about: Report a reproducible bug
title: "[BUG] "
labels: bug
assignees: ""
---

## Describe the bug

A clear description.
`
    );
    // "name", "about" are not recognized keys.
    // BUT "title" and "labels" ARE recognized — this block WILL be parsed as glw frontmatter.
    // That's correct behavior per spec: "if it contains at least one recognized key"
    const result = parseIssueFile(f);
    expect(result.title).toBe("[BUG] ");
    expect(result.labels).toEqual(["bug"]);
  });

  it("pure template metadata with NO recognized keys — full content becomes body, H1 still extracted", () => {
    const f = write(
      "pure-template.md",
      `---
name: Feature Request
about: Suggest an idea
category: enhancement
---

# Feature: Something

Please describe the feature.
`
    );
    // "name", "about", "category" are not recognized → whole content treated as body
    // H1 extraction then applies to that full content (including ---block)
    const result = parseIssueFile(f);
    // H1 "Feature: Something" is found inside the full-content body
    expect(result.title).toBe("Feature: Something");
    // description should not include the H1 heading itself
    expect(result.description).toContain("Please describe the feature.");
    // The --- block is part of the body content fed to H1 extraction, not a separate field
    expect(result.labels).toBeUndefined();
  });

  it("pure template with H1 after: title extracted from H1 in body", () => {
    const f = write(
      "pure-template-h1.md",
      `---
name: Feature Request
about: Suggest an idea
---

# My Feature Title

Feature body here.
`
    );
    // No recognized keys → whole content is body → H1 extraction happens on full content
    const result = parseIssueFile(f);
    // The full content passed to body extraction includes the ---block + H1
    // H1 "My Feature Title" should be found
    expect(result.title).toBe("My Feature Title");
    expect(result.description).toContain("Feature body here.");
  });
});

// ─── .txt tests ───────────────────────────────────────────────────────────────

describe("parseIssueFile — .txt files", () => {
  it("uses first line as title", () => {
    const f = write("simple.txt", `First Line Is Title\n\nRest of the content.`);
    const result = parseIssueFile(f);
    expect(result.title).toBe("First Line Is Title");
    expect(result.description).toBe("Rest of the content.");
  });

  it("parses txt with frontmatter", () => {
    const f = write(
      "fm.txt",
      `---
title: Txt Issue
weight: 3
---
Description text.
`
    );
    const result = parseIssueFile(f);
    expect(result.title).toBe("Txt Issue");
    expect(result.weight).toBe(3);
    expect(result.description).toBe("Description text.");
  });
});

// ─── JSON tests ───────────────────────────────────────────────────────────────

describe("parseIssueFile — JSON files", () => {
  it("parses all fields", () => {
    const f = write(
      "issue.json",
      JSON.stringify({
        title: "JSON Issue",
        description: "A description",
        labels: ["a", "b"],
        assignees: ["alice"],
        weight: 8,
        estimate: "3h",
        start: "2026-07-01",
        due: "2026-07-31",
        status: "To do",
        confidential: false,
        type: "Issue",
      })
    );
    const result = parseIssueFile(f);
    expect(result.title).toBe("JSON Issue");
    expect(result.description).toBe("A description");
    expect(result.labels).toEqual(["a", "b"]);
    expect(result.weight).toBe(8);
    expect(result.estimate).toBe("3h");
    expect(result.confidential).toBe(false);
    expect(result.type).toBe("Issue");
  });

  it("accepts 'body' as alias for 'description'", () => {
    const f = write(
      "body-alias.json",
      JSON.stringify({ title: "T", body: "Body text" })
    );
    const result = parseIssueFile(f);
    expect(result.description).toBe("Body text");
  });
});
