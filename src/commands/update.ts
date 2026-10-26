import { readFileSync } from 'node:fs';

import { buildTimeTrackingWidget } from '../api/time-tracking.ts';
import { updateWorkItem } from '../api/work-items.ts';
import { csv, JSON_OUT, PROJECT, parseFlags, YES } from '../cli/args.ts';
import { projectConfig } from '../cli/context.ts';
import { forEachItem, warnScopedLabelConflicts } from '../cli/output.ts';
import { confirmOrAbort } from '../cli/prompt.ts';
import { printSelection, SELECTION, selectItems } from '../cli/selection.ts';
import { CliError } from '../errors.ts';
import { bold, cyan, dim, green } from '../format.ts';
import { buildUpdateInput, type UpdateFields } from './update-input.ts';

import type { Command } from '../cli/command.ts';

const OPTIONS = {
    ...PROJECT,
    ...SELECTION,
    title: { type: 'string' },
    body: { type: 'string' },
    'body-file': { type: 'string' },
    status: { type: 'string' },
    assignee: { type: 'string' },
    labels: { type: 'string' },
    'add-label': { type: 'string', multiple: true },
    'remove-label': { type: 'string', multiple: true },
    weight: { type: 'string' },
    start: { type: 'string' },
    due: { type: 'string' },
    estimate: { type: 'string' },
    spend: { type: 'string' },
    date: { type: 'string' },
    summary: { type: 'string' },
    'dry-run': { type: 'boolean' },
    ...YES,
    ...JSON_OUT,
} as const;

type Values = ReturnType<typeof parseFlags<typeof OPTIONS>>['values'];

function readBody(text?: string, file?: string): string | undefined {
    if (text) return text;
    if (!file) return undefined;
    try {
        return readFileSync(file, 'utf-8');
    } catch (err) {
        throw new CliError(`File not found: ${file}`, { cause: err });
    }
}

/** Флаги в поля; всё, что можно проверить без сети, проверяется здесь. */
function readFields(values: Values): UpdateFields {
    const fields: UpdateFields = {
        title: values.title,
        body: readBody(values.body, values['body-file']),
        status: values.status,
        assignee: values.assignee,
        labels: values.labels === undefined ? undefined : csv(values.labels),
        addLabel: values['add-label'],
        removeLabel: values['remove-label'],
        weight: values.weight,
        start: values.start,
        due: values.due,
        estimate: values.estimate,
        spend: values.spend,
        spendDate: values.date,
        spendSummary: values.summary,
    };

    // Дата и описание списания без самого списания ничего не меняют.
    const hasChange = Object.entries(fields).some(
        ([key, v]) =>
            v !== undefined && key !== 'spendDate' && key !== 'spendSummary',
    );
    if (!hasChange) {
        throw new CliError(
            'At least one field flag is required. Run: glw update --help',
        );
    }
    if (fields.weight !== undefined && !/^(\d+|none)$/.test(fields.weight)) {
        throw new CliError(
            `Invalid weight "${fields.weight}". Expected a whole number or "none"`,
        );
    }
    buildTimeTrackingWidget(fields);
    warnScopedLabelConflicts([
        ...(fields.labels ?? []),
        ...(fields.addLabel ?? []),
    ]);
    return fields;
}

export const update: Command = {
    name: 'update',
    aliases: ['u'],
    synopsis: 'update [iid...] ...',
    summary: 'Update one or more work items',
    help: () => `
glw update [iid...] [selection flags] [field flags] [--yes] [--dry-run]

Selection:
  Positional iids     Specific issues
  --search <q>        Filter by search query
  --filter-assignee   Filter by assignee
  --filter-label      Filter by label
  --state <s>         State filter (default: opened)

Field flags:
  --title <t>         Set title
  --body <text>       Set description
  --body-file <f>     Set description from file
  --status <name>     Set status
  --assignee <u>      Set assignee (username, @me, none)
  --labels <csv>      Set labels (replaces all)
  --add-label <l>     Add label (repeatable)
  --remove-label <l>  Remove label (repeatable)
  --weight <n|none>   Set weight (or "none" to clear)
  --start <date|none> Set start date (or "none" to clear)
  --due <date|none>   Set due date (or "none" to clear)
  --estimate <dur>    Set time estimate
  --spend <dur>       Log time spent
  --date YYYY-MM-DD   Day the time was spent (default: today)
  --summary <s>       Summary for time log
  --yes               Skip confirmation
  --dry-run           Preview without making changes
  --project <path>    Override project
`,
    async run(args) {
        const { values, positionals } = parseFlags(args, OPTIONS);
        const fields = readFields(values);

        const config = await projectConfig(values.project);
        const { items, byFilter } = await selectItems(
            config,
            positionals,
            values,
        );
        const dryRun = values['dry-run'];

        if (byFilter) {
            if (items.length === 0) {
                console.log(dim('No matching work items found.'));
                return;
            }
            printSelection(items);
            if (dryRun) {
                console.log(
                    dim(
                        '(dry-run) Changes would be applied to the above items.',
                    ),
                );
                console.log(dim(`Fields: ${JSON.stringify(fields)}`));
                return;
            }
            const question = `Apply changes to ${items.length} item(s)?`;
            if (!(await confirmOrAbort(question, values.yes))) return;
        } else if (dryRun) {
            console.log(dim('(dry-run) Would update:'));
            for (const item of items)
                console.log(dim(`  #${item.iid} ${item.title}`));
            return;
        }

        await forEachItem(
            items,
            (item) => `#${item.iid}`,
            async (item) => {
                const input = await buildUpdateInput(config, item, fields);
                const updated = await updateWorkItem(config, input);
                console.log(
                    `${green('Updated')} ${cyan(`#${updated.iid}`)} ${bold(updated.title)}`,
                );
            },
        );
    },
};
