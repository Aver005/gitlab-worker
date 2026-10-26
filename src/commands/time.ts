import {
    buildTimeTrackingWidget,
    validateDuration,
} from '../api/time-tracking.ts';
import { normalizeIid } from '../api/work-item.ts';
import { getWorkItemByIid, updateWorkItem } from '../api/work-items.ts';
import { PROJECT, parseFlags } from '../cli/args.ts';
import { projectConfig } from '../cli/context.ts';
import { CliError } from '../errors.ts';
import { bold, cyan, green } from '../format.ts';

import type { Command } from '../cli/command.ts';

export const estimate: Command = {
    name: 'estimate',
    synopsis: 'estimate <iid> <dur>',
    summary: 'Set time estimate (e.g. 2h, 1h30m)',
    help: () =>
        'glw estimate <iid> <dur>\n\nSet time estimate. E.g.: glw estimate 42 2h',
    async run(args) {
        const { values, positionals } = parseFlags(args, PROJECT);
        const [iid, dur] = positionals;
        if (!iid || !dur) throw new CliError('Usage: glw estimate <iid> <dur>');
        const timeEstimate = validateDuration(dur);

        const config = await projectConfig(values.project);
        const item = await getWorkItemByIid(config, normalizeIid(iid));
        await updateWorkItem(config, {
            id: item.id,
            timeTrackingWidget: { timeEstimate },
        });
        console.log(
            `${green('Estimate set')} on ${cyan(`#${item.iid}`)}: ${bold(timeEstimate)}`,
        );
    },
};

export const spend: Command = {
    name: 'spend',
    synopsis: 'spend <iid> <dur>',
    summary: 'Log time spent',
    help: () => `
glw spend <iid> <dur> [--date YYYY-MM-DD] [--summary <s>]

Log time spent.

Flags:
  --date YYYY-MM-DD   Day the time was spent (default: today)
  --summary <s>       Summary for the time log

Examples:
  glw spend 42 1h30m --summary "code review"
  glw spend 42 4h --date 2026-10-15
`,
    async run(args) {
        const { values, positionals } = parseFlags(args, {
            ...PROJECT,
            summary: { type: 'string' },
            date: { type: 'string' },
        });
        const [iid, dur] = positionals;
        if (!iid || !dur) throw new CliError('Usage: glw spend <iid> <dur>');
        const widget = buildTimeTrackingWidget({
            spend: dur,
            spendDate: values.date,
            spendSummary: values.summary,
        });

        const config = await projectConfig(values.project);
        const item = await getWorkItemByIid(config, normalizeIid(iid));
        await updateWorkItem(config, {
            id: item.id,
            timeTrackingWidget: widget,
        });
        const date = values.date ? ` (${values.date})` : '';
        console.log(
            `${green('Time logged')} on ${cyan(`#${item.iid}`)}: ${bold(validateDuration(dur))}${date}`,
        );
    },
};
