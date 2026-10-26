import { getWorkItemByIid } from '../api/work-items.ts';
import { csv, JSON_OUT, PROJECT, parseFlags, YES } from '../cli/args.ts';
import { projectConfig } from '../cli/context.ts';
import { printJson } from '../cli/output.ts';
import { CliError } from '../errors.ts';
import { bold, cyan, dim, green } from '../format.ts';
import {
    applyOverrides,
    expandIssueFiles,
    parseIssueFile,
    type IssueFileData,
} from '../inputfile.ts';
import { createBatch } from './create-batch.ts';
import { executeCreate, planCreate, printCreatePlan } from './create-plan.ts';

import type { Command } from '../cli/command.ts';

const OPTIONS = {
    ...PROJECT,
    title: { type: 'string' },
    label: { type: 'string', multiple: true },
    labels: { type: 'string' },
    assignee: { type: 'string' },
    weight: { type: 'string' },
    start: { type: 'string' },
    due: { type: 'string' },
    estimate: { type: 'string' },
    spend: { type: 'string' },
    date: { type: 'string' },
    summary: { type: 'string' },
    status: { type: 'string' },
    confidential: { type: 'boolean' },
    type: { type: 'string' },
    'dry-run': { type: 'boolean' },
    ...YES,
    ...JSON_OUT,
} as const;

type Values = ReturnType<typeof parseFlags<typeof OPTIONS>>['values'];

/** Флаги, которые перекрывают поля из файла; незаданные остаются из файла. */
function overridesFrom(values: Values): IssueFileData {
    return {
        title: values.title,
        confidential: values.confidential || undefined,
        weight: values.weight === undefined ? undefined : Number(values.weight),
        start: values.start,
        due: values.due,
        estimate: values.estimate,
        spend: values.spend,
        spendDate: values.date,
        spendSummary: values.summary,
        status: values.status,
        type: values.type,
        assignees: values.assignee ? [values.assignee] : undefined,
    };
}

export const create: Command = {
    name: 'create',
    aliases: ['cr'],
    synopsis: 'create <file|dir>...',
    summary: 'Create work items from files',
    help: () => `
glw create <file|dir>... [flags]

Create work items from files (.md, .txt, .json). Several files or a directory
create one item per file, continue past failures and end with a summary.

Arguments:
  <file>              Path to an issue file
  <dir>               Every .md/.markdown/.txt/.json file directly inside it
                      (no subdirectories, natural sort); asks to confirm

Flags:
  --title <t>         Override/set title
  --label <l>         Add label (repeatable)
  --labels <csv>      Set labels as comma-separated list
  --assignee <u>      Assign to user (username, @me)
  --weight <n>        Set weight
  --start YYYY-MM-DD  Set start date
  --due YYYY-MM-DD    Set due date
  --estimate <dur>    Set time estimate (e.g. 2h)
  --spend <dur>       Log time spent right after creation
  --date YYYY-MM-DD   Day the time was spent (default: today)
  --summary <s>       Summary for the time log
  --status <name>     Set status (e.g. "In progress")
  --confidential      Mark as confidential
  --type <name>       Work item type (default: Issue)
  --dry-run           Show parsed and final fields, check names on the server, send nothing
  --yes               Skip the confirmation for a directory
  --project <path>    Override project
  --json              Full created item, same shape as "view --json";
                      several files: [{ file, item?, error? }]

Flags apply to every file. --title works with a single file only.
`,
    async run(args) {
        const { values, positionals } = parseFlags(args, OPTIONS);

        if (positionals.length === 0) {
            throw new CliError('Usage: glw create <file|dir>...');
        }
        const { files, fromDir } = expandIssueFiles(positionals);
        if (files.length === 0) {
            throw new CliError(
                `No .md/.txt/.json files found in: ${positionals.join(', ')}`,
            );
        }
        if (values.title && files.length > 1) {
            throw new CliError("--title can't be used with several files");
        }

        const overrides = overridesFrom(values);
        const extraLabels = [...(values.label ?? []), ...csv(values.labels)];
        const dryRun = Boolean(values['dry-run']);
        const json = Boolean(values.json);
        const config = await projectConfig(values.project);

        if (files.length > 1 || fromDir) {
            await createBatch(config, files, {
                overrides,
                extraLabels,
                dryRun,
                json,
                askFirst: fromDir && !values.yes,
            });
            return;
        }

        const file = files[0]!;
        const parsed = parseIssueFile(file);
        const data = applyOverrides(parsed, overrides, extraLabels);
        const plan = await planCreate(config, data);

        if (dryRun) {
            const { input, timeTracking, problems } = plan;
            if (json) {
                printJson({
                    file,
                    parsed,
                    final: data,
                    input,
                    timeTracking,
                    problems,
                });
            } else {
                printCreatePlan(file, parsed, data, problems);
            }
            if (problems.length > 0) process.exitCode = 1;
            return;
        }
        if (plan.problems.length > 0)
            throw new CliError(plan.problems.join('\n'));

        const { created, followUpError } = await executeCreate(config, plan);
        if (json) {
            // Перечитываем, чтобы виджеты были такими, как их сохранил GitLab.
            printJson(await getWorkItemByIid(config, created.iid));
        } else {
            console.log(
                `${green('Created')} ${cyan(`#${created.iid}`)} ${bold(created.title)}`,
            );
            console.log(dim(created.webUrl));
        }
        if (followUpError) throw new CliError(followUpError);
    },
};
