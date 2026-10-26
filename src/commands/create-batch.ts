import { getWorkItemByIid } from '../api/work-items.ts';
import { printJson } from '../cli/output.ts';
import { confirmOrAbort } from '../cli/prompt.ts';
import { errorText } from '../errors.ts';
import { formatFieldTable } from '../fields.ts';
import { bold, cyan, dim, green, red, yellow } from '../format.ts';
import {
    applyOverrides,
    parseIssueFile,
    type IssueFileData,
} from '../inputfile.ts';
import { executeCreate, planCreate, printCreatePlan } from './create-plan.ts';

import type { Config } from '../config/load.ts';

export interface BatchOptions {
    overrides: IssueFileData;
    extraLabels: string[];
    dryRun: boolean;
    json: boolean;
    askFirst: boolean;
}

interface FileResult {
    file: string;
    result: string;
    failed: boolean;
    json: unknown;
}

async function processFile(
    config: Config,
    file: string,
    opts: BatchOptions,
): Promise<FileResult> {
    const failure = (error: string): FileResult => {
        if (!opts.json) console.error(red(`Failed ${file}: ${error}`));
        return {
            file,
            result: `✗ ${error}`,
            failed: true,
            json: opts.dryRun ? { file, problems: [error] } : { file, error },
        };
    };

    let parsed: IssueFileData;
    try {
        parsed = parseIssueFile(file);
    } catch (err) {
        return failure(errorText(err));
    }

    const data = applyOverrides(parsed, opts.overrides, opts.extraLabels);
    const plan = await planCreate(config, data);
    const { input, timeTracking, problems } = plan;

    if (opts.dryRun) {
        if (!opts.json) printCreatePlan(file, parsed, data, problems);
        const failed = problems.length > 0;
        return {
            file,
            result: failed
                ? `✗ ${problems.length} problem(s)`
                : `ok: ${data.title}`,
            failed,
            json: { file, parsed, final: data, input, timeTracking, problems },
        };
    }
    if (problems.length > 0) return failure(problems.join('; '));

    try {
        const { created, followUpError } = await executeCreate(config, plan);
        if (!opts.json) {
            console.log(
                `${green('Created')} ${cyan(`#${created.iid}`)} ${bold(created.title)} ${dim(file)}`,
            );
            if (followUpError) console.error(red(followUpError));
        }
        const item = opts.json
            ? await getWorkItemByIid(config, created.iid)
            : undefined;
        return {
            file,
            result:
                `#${created.iid} ${created.title}` +
                (followUpError ? ` ✗ ${followUpError}` : ''),
            failed: Boolean(followUpError),
            json: followUpError
                ? { file, item, error: followUpError }
                : { file, item },
        };
    } catch (err) {
        const error = errorText(err);
        if (!opts.json) console.error(red(`Failed ${file}: ${error}`));
        return {
            file,
            result: `✗ ${error}`,
            failed: true,
            json: { file, error },
        };
    }
}

function printSummary(results: FileResult[], dryRun: boolean): void {
    const failed = results.filter((r) => r.failed).length;
    const okWord = dryRun ? 'ready' : 'created';
    console.log(
        `\n${bold('Summary')}: ${results.length - failed} ${okWord}, ${failed} failed`,
    );
    const [header, ...lines] = formatFieldTable(
        results.map(({ file, result }) => ({ file, result })),
        ['file', 'result'],
    );
    console.log(`  ${dim(header!)}`);
    lines.forEach((line, i) =>
        console.log(`  ${results[i]!.failed ? red(line) : line}`),
    );
}

/** Задача на файл; сбой одного файла не останавливает остальные. */
export async function createBatch(
    config: Config,
    files: string[],
    opts: BatchOptions,
): Promise<void> {
    if (opts.askFirst && !opts.dryRun) {
        console.log(
            `\nWill create ${yellow(String(files.length))} work item(s) from:\n`,
        );
        for (const f of files) console.log(`  ${f}`);
        console.log();
        if (!(await confirmOrAbort(`Create ${files.length} item(s)?`, false))) {
            return;
        }
    }

    const results: FileResult[] = [];
    for (const file of files)
        results.push(await processFile(config, file, opts));

    if (opts.json) printJson(results.map((r) => r.json));
    else printSummary(results, opts.dryRun);
    if (results.some((r) => r.failed)) process.exitCode = 1;
}
