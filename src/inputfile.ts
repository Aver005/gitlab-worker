import { readFileSync } from "node:fs";
import { extname } from "node:path";

export interface IssueFileData {
  title?: string;
  description?: string;
  labels?: string[];
  assignees?: string[];
  weight?: number;
  estimate?: string;
  start?: string;
  due?: string;
  status?: string;
  confidential?: boolean;
  type?: string;
}

/** Keys glw recognizes in YAML frontmatter */
const RECOGNIZED_KEYS = new Set([
  "title",
  "labels",
  "assignees",
  "assignee",
  "weight",
  "estimate",
  "start",
  "start_date",
  "due",
  "due_date",
  "status",
  "confidential",
  "type",
]);

/**
 * Minimal flat YAML value parser.
 * Handles: quoted strings, numbers, booleans, inline arrays [a, b], bare strings.
 */
function parseYamlValue(raw: string): string | number | boolean | string[] {
  const v = raw.trim();

  // Inline array: [a, b, c]
  if (v.startsWith("[") && v.endsWith("]")) {
    const inner = v.slice(1, -1);
    return splitCsv(inner);
  }

  // Quoted string
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1);
  }

  // Boolean
  if (v === "true") return true;
  if (v === "false") return false;

  // Number
  const num = Number(v);
  if (!Number.isNaN(num) && v !== "") return num;

  return v;
}

function splitCsv(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length > 0);
}

interface FrontmatterResult {
  /** Recognized key-value pairs from frontmatter */
  data: Record<string, string | number | boolean | string[]>;
  /** Lines after the closing --- */
  body: string;
  /** Whether frontmatter was detected AND contained at least one recognized key */
  hadRecognizedFrontmatter: boolean;
}

/**
 * Try to parse YAML frontmatter from a markdown/text file body.
 * Frontmatter is only treated as glw frontmatter if it contains at least
 * one recognized key; otherwise the whole content (including ---blocks) is
 * returned as body (handles GitLab issue-template metadata headers).
 */
function extractFrontmatter(content: string): FrontmatterResult {
  const lines = content.split("\n");

  // Must start with ---
  if (!lines[0] || lines[0].trim() !== "---") {
    return { data: {}, body: content, hadRecognizedFrontmatter: false };
  }

  // Find closing ---
  let closingIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") {
      closingIdx = i;
      break;
    }
  }

  if (closingIdx === -1) {
    // No closing --- found; treat as body
    return { data: {}, body: content, hadRecognizedFrontmatter: false };
  }

  const fmLines = lines.slice(1, closingIdx);
  const bodyLines = lines.slice(closingIdx + 1);

  const data: Record<string, string | number | boolean | string[]> = {};
  const unknownKeys: string[] = [];
  let hasRecognized = false;

  for (const line of fmLines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const rawValue = line.slice(colonIdx + 1);

    if (RECOGNIZED_KEYS.has(key)) {
      hasRecognized = true;
      data[key] = parseYamlValue(rawValue);
    } else {
      unknownKeys.push(key);
    }
  }

  if (!hasRecognized) {
    // GitLab issue-template header or unrelated frontmatter — treat whole content as body
    return { data: {}, body: content, hadRecognizedFrontmatter: false };
  }

  // Warn about unknown keys (only if frontmatter was recognized)
  for (const k of unknownKeys) {
    process.stderr.write(
      `glw: warning: unknown frontmatter key "${k}" — ignored\n`
    );
  }

  return {
    data,
    body: bodyLines.join("\n"),
    hadRecognizedFrontmatter: true,
  };
}

function asString(v: string | number | boolean | string[]): string {
  return String(v);
}

function asStringArray(v: string | number | boolean | string[]): string[] {
  if (Array.isArray(v)) return v;
  const s = String(v);
  // Check if it looks like a comma-separated list
  if (s.includes(",")) return splitCsv(s);
  return [s];
}

function asBool(v: string | number | boolean | string[]): boolean {
  if (typeof v === "boolean") return v;
  const s = String(v).toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

function asNumber(v: string | number | boolean | string[]): number {
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`Expected a number, got "${v}"`);
  return n;
}

/**
 * Parse a markdown or text file with optional YAML frontmatter.
 */
function parseMarkdownOrText(
  content: string,
  ext: string
): IssueFileData {
  const { data, body, hadRecognizedFrontmatter } = extractFrontmatter(content);

  const result: IssueFileData = {};

  if (hadRecognizedFrontmatter) {
    if ("title" in data) result.title = asString(data["title"]!);
    if ("labels" in data) result.labels = asStringArray(data["labels"]!);
    if ("assignees" in data) result.assignees = asStringArray(data["assignees"]!);
    if ("assignee" in data) {
      result.assignees = result.assignees
        ? [...result.assignees, ...asStringArray(data["assignee"]!)]
        : asStringArray(data["assignee"]!);
    }
    if ("weight" in data) result.weight = asNumber(data["weight"]!);
    if ("estimate" in data) result.estimate = asString(data["estimate"]!);
    if ("start" in data) result.start = asString(data["start"]!);
    if ("start_date" in data) result.start = asString(data["start_date"]!);
    if ("due" in data) result.due = asString(data["due"]!);
    if ("due_date" in data) result.due = asString(data["due_date"]!);
    if ("status" in data) result.status = asString(data["status"]!);
    if ("confidential" in data) result.confidential = asBool(data["confidential"]!);
    if ("type" in data) result.type = asString(data["type"]!);
  }

  const bodyTrimmed = body.trim();

  // Extract title from body if not in frontmatter
  if (!result.title) {
    if (ext === ".md" || ext === ".markdown") {
      // Look for first # H1 heading
      const h1Match = bodyTrimmed.match(/^#\s+(.+)$/m);
      if (h1Match) {
        result.title = h1Match[1]!.trim();
        // Strip that heading from description
        const withoutH1 = bodyTrimmed.replace(/^#\s+.+$/m, "").trim();
        result.description = withoutH1 || undefined;
        return result;
      }
    } else {
      // .txt: use first non-empty line
      const firstLine = bodyTrimmed.split("\n").find((l) => l.trim());
      if (firstLine) {
        result.title = firstLine.trim();
        const rest = bodyTrimmed
          .slice(bodyTrimmed.indexOf(firstLine) + firstLine.length)
          .trim();
        result.description = rest || undefined;
        return result;
      }
    }
  }

  result.description = bodyTrimmed || undefined;
  return result;
}

/**
 * Parse a JSON issue file.
 */
function parseJson(content: string): IssueFileData {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(content) as Record<string, unknown>;
  } catch {
    throw new Error(`Failed to parse issue file as JSON`);
  }

  const result: IssueFileData = {};

  if (typeof obj["title"] === "string") result.title = obj["title"];
  if (typeof obj["description"] === "string")
    result.description = obj["description"];
  else if (typeof obj["body"] === "string") result.description = obj["body"];

  if (Array.isArray(obj["labels"]))
    result.labels = (obj["labels"] as unknown[]).map(String);
  else if (typeof obj["labels"] === "string")
    result.labels = splitCsv(obj["labels"]);

  if (Array.isArray(obj["assignees"]))
    result.assignees = (obj["assignees"] as unknown[]).map(String);
  else if (typeof obj["assignees"] === "string")
    result.assignees = splitCsv(obj["assignees"]);

  if (typeof obj["weight"] === "number") result.weight = obj["weight"];
  if (typeof obj["estimate"] === "string") result.estimate = obj["estimate"];
  if (typeof obj["start"] === "string") result.start = obj["start"];
  if (typeof obj["due"] === "string") result.due = obj["due"];
  if (typeof obj["status"] === "string") result.status = obj["status"];
  if (typeof obj["confidential"] === "boolean")
    result.confidential = obj["confidential"];
  if (typeof obj["type"] === "string") result.type = obj["type"];

  return result;
}

/**
 * Parse an issue file (markdown, text, or JSON) into structured data.
 */
export function parseIssueFile(filePath: string): IssueFileData {
  let content: string;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    throw new Error(`Cannot read file: ${filePath}`);
  }

  const ext = extname(filePath).toLowerCase();

  if (ext === ".json") {
    return parseJson(content);
  }

  return parseMarkdownOrText(content, ext);
}
