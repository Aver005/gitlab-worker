/** Файл задачи (md, txt, json) в поля задачи; YAML-шапка — плоский мини-разбор. */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';

export interface IssueFileData {
    title?: string;
    description?: string;
    labels?: string[];
    assignees?: string[];
    weight?: number;
    estimate?: string;
    spend?: string;
    spendDate?: string;
    spendSummary?: string;
    start?: string;
    due?: string;
    status?: string;
    confidential?: boolean;
    type?: string;
}

type YamlValue = string | number | boolean | string[];

function splitCsv(s: string): string[] {
    return s
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
}

function asStringArray(v: YamlValue): string[] {
    if (Array.isArray(v)) return v;
    return splitCsv(String(v));
}

function asNumber(v: YamlValue): number {
    const n = Number(v);
    if (Number.isNaN(n)) throw new Error(`Expected a number, got "${v}"`);
    return n;
}

function asBool(v: YamlValue): boolean {
    if (typeof v === 'boolean') return v;
    return ['true', '1', 'yes'].includes(String(v).toLowerCase());
}

/** Ключ шапки → как он ложится в поля задачи. */
const FRONTMATTER: Record<string, (d: IssueFileData, v: YamlValue) => void> = {
    title: (d, v) => (d.title = String(v)),
    labels: (d, v) => (d.labels = asStringArray(v)),
    assignees: (d, v) =>
        (d.assignees = [...(d.assignees ?? []), ...asStringArray(v)]),
    assignee: (d, v) =>
        (d.assignees = [...(d.assignees ?? []), ...asStringArray(v)]),
    weight: (d, v) => (d.weight = asNumber(v)),
    estimate: (d, v) => (d.estimate = String(v)),
    spend: (d, v) => (d.spend = String(v)),
    spend_date: (d, v) => (d.spendDate = String(v)),
    spend_summary: (d, v) => (d.spendSummary = String(v)),
    start: (d, v) => (d.start = String(v)),
    start_date: (d, v) => (d.start = String(v)),
    due: (d, v) => (d.due = String(v)),
    due_date: (d, v) => (d.due = String(v)),
    status: (d, v) => (d.status = String(v)),
    confidential: (d, v) => (d.confidential = asBool(v)),
    type: (d, v) => (d.type = String(v)),
};

/** Кавычки, числа, булевы и [a, b]; остальное — строка как есть. */
function parseYamlValue(raw: string): YamlValue {
    const v = raw.trim();
    if (v.startsWith('[') && v.endsWith(']')) return splitCsv(v.slice(1, -1));
    if (/^(".*"|'.*')$/.test(v)) return v.slice(1, -1);
    if (v === 'true') return true;
    if (v === 'false') return false;
    const num = Number(v);
    if (v !== '' && !Number.isNaN(num)) return num;
    return v;
}

/**
 * Шапка считается шапкой glw, только если в ней есть хоть один известный ключ:
 * иначе это шаблон GitLab (`name:`/`about:`), и весь файл уходит в описание.
 */
function extractFrontmatter(
    content: string,
    source: string,
): { data: IssueFileData; body: string } | null {
    const lines = content.split('\n');
    if (lines[0]?.trim() !== '---') return null;
    const closing = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
    if (closing === -1) return null;

    const entries: Array<[string, YamlValue]> = [];
    const unknown: string[] = [];
    for (const line of lines.slice(1, closing)) {
        const colon = line.indexOf(':');
        if (!line.trim() || line.trim().startsWith('#') || colon === -1) {
            continue;
        }
        const key = line.slice(0, colon).trim().toLowerCase();
        if (key in FRONTMATTER) {
            entries.push([key, parseYamlValue(line.slice(colon + 1))]);
        } else {
            unknown.push(key);
        }
    }
    if (entries.length === 0) return null;

    for (const key of unknown) {
        process.stderr.write(
            `glw: warning: ${source}: unknown frontmatter key "${key}" — ignored\n`,
        );
    }
    const data: IssueFileData = {};
    for (const [key, value] of entries) FRONTMATTER[key]!(data, value);
    return { data, body: lines.slice(closing + 1).join('\n') };
}

/** Без заголовка в шапке им становится первый `# H1` (md) или первая строка (txt). */
function parseMarkdownOrText(
    content: string,
    ext: string,
    source: string,
): IssueFileData {
    const frontmatter = extractFrontmatter(content, source);
    const result: IssueFileData = frontmatter?.data ?? {};
    const body = (frontmatter?.body ?? content).trim();

    if (!result.title) {
        const isMarkdown = ext === '.md' || ext === '.markdown';
        const heading = isMarkdown
            ? /^#\s+(.+)$/m.exec(body)
            : /^\s*(\S.*)$/m.exec(body);
        if (heading) {
            result.title = heading[1]!.trim();
            const end = heading.index + heading[0].length;
            const rest = (
                body.slice(0, heading.index) + body.slice(end)
            ).trim();
            result.description = rest || undefined;
            return result;
        }
    }

    result.description = body || undefined;
    return result;
}

function parseJson(content: string): IssueFileData {
    let obj: Record<string, unknown>;
    try {
        obj = JSON.parse(content) as Record<string, unknown>;
    } catch (err) {
        throw new Error('Failed to parse issue file as JSON', { cause: err });
    }

    const str = (key: string) =>
        typeof obj[key] === 'string' ? obj[key] : undefined;
    const list = (key: string) => {
        const v = obj[key];
        if (Array.isArray(v)) return v.map(String);
        return typeof v === 'string' ? splitCsv(v) : undefined;
    };

    const result: IssueFileData = {
        title: str('title'),
        description: str('description') ?? str('body'),
        labels: list('labels'),
        assignees: list('assignees'),
        weight: typeof obj['weight'] === 'number' ? obj['weight'] : undefined,
        estimate: str('estimate'),
        spend: str('spend'),
        spendDate: str('spend_date'),
        spendSummary: str('spend_summary'),
        start: str('start'),
        due: str('due'),
        status: str('status'),
        confidential:
            typeof obj['confidential'] === 'boolean'
                ? obj['confidential']
                : undefined,
        type: str('type'),
    };
    return Object.fromEntries(
        Object.entries(result).filter(([, v]) => v !== undefined),
    ) as IssueFileData;
}

export function parseIssueFile(filePath: string): IssueFileData {
    let content: string;
    try {
        content = readFileSync(filePath, 'utf-8');
    } catch (err) {
        throw new Error(`Cannot read file: ${filePath}`, { cause: err });
    }
    const ext = extname(filePath).toLowerCase();
    return ext === '.json'
        ? parseJson(content)
        : parseMarkdownOrText(content, ext, filePath);
}

const ISSUE_FILE_EXTS = new Set(['.md', '.markdown', '.txt', '.json']);

/** Каталог — его файлы задач верхнего уровня в естественном порядке. */
export function expandIssueFiles(paths: string[]): {
    files: string[];
    fromDir: boolean;
} {
    const files: string[] = [];
    let fromDir = false;
    for (const p of paths) {
        let isDir: boolean;
        try {
            isDir = statSync(p).isDirectory();
        } catch (err) {
            throw new Error(`Cannot read file: ${p}`, { cause: err });
        }
        if (!isDir) {
            files.push(p);
            continue;
        }
        fromDir = true;
        const names = readdirSync(p)
            .filter(
                (n) =>
                    ISSUE_FILE_EXTS.has(extname(n).toLowerCase()) &&
                    statSync(join(p, n)).isFile(),
            )
            .toSorted((a, b) =>
                a.localeCompare(b, undefined, { numeric: true }),
            );
        files.push(...names.map((n) => join(p, n)));
    }
    return { files: [...new Set(files)], fromDir };
}

/** Заданные флаги важнее файла; дополнительные метки дописываются к файловым. */
export function applyOverrides(
    data: IssueFileData,
    overrides: IssueFileData,
    extraLabels: string[] = [],
): IssueFileData {
    const defined = Object.entries(overrides).filter(
        ([, v]) => v !== undefined,
    );
    const merged: IssueFileData = { ...data, ...Object.fromEntries(defined) };
    if (extraLabels.length > 0) {
        merged.labels = [...(data.labels ?? []), ...extraLabels];
    }
    return merged;
}
