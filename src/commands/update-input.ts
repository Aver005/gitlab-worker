import { resolveLabels } from '../api/labels.ts';
import { resolveStatus } from '../api/statuses.ts';
import { buildTimeTrackingWidget } from '../api/time-tracking.ts';
import { resolveUser } from '../api/users.ts';
import { getDates, getLabels, type WorkItemNode } from '../api/work-item.ts';
import { type WorkItemUpdateInput } from '../api/work-items.ts';

import type { Config } from '../config/load.ts';

/** Значение `none` у weight, start, due и assignee очищает поле. */
export interface UpdateFields {
    title?: string;
    body?: string;
    status?: string;
    assignee?: string;
    /** Полный набор меток, заменяет текущие. */
    labels?: string[];
    addLabel?: string[];
    removeLabel?: string[];
    weight?: string;
    start?: string;
    due?: string;
    estimate?: string;
    spend?: string;
    spendDate?: string;
    spendSummary?: string;
}

// labelsWidget умеет только add/remove, поэтому «установить метки» — разница с текущими.
async function labelChanges(
    config: Config,
    item: WorkItemNode,
    fields: UpdateFields,
): Promise<{ add: string[]; remove: string[] }> {
    const current = getLabels(item);
    const currentIds = current.map((l) => l.id);
    const add = new Set<string>();
    const remove = new Set<string>();

    if (fields.labels !== undefined) {
        const desired = fields.labels.length
            ? await resolveLabels(config, fields.labels)
            : [];
        for (const id of desired) if (!currentIds.includes(id)) add.add(id);
        for (const id of currentIds) if (!desired.includes(id)) remove.add(id);
    }
    if (fields.addLabel?.length) {
        for (const id of await resolveLabels(config, fields.addLabel))
            add.add(id);
    }
    if (fields.removeLabel?.length) {
        const notOnItem: string[] = [];
        for (const name of fields.removeLabel) {
            const label = current.find(
                (l) => l.title.toLowerCase() === name.toLowerCase(),
            );
            if (label) remove.add(label.id);
            else notOnItem.push(name);
        }
        if (notOnItem.length > 0) {
            process.stderr.write(
                `glw: warning: labels not found on #${item.iid}: ${notOnItem.join(', ')}\n`,
            );
        }
    }
    return { add: [...add], remove: [...remove] };
}

const orNone = (value: string) => (value === 'none' ? null : value);

export async function buildUpdateInput(
    config: Config,
    item: WorkItemNode,
    fields: UpdateFields,
): Promise<WorkItemUpdateInput> {
    const input: WorkItemUpdateInput = { id: item.id };

    if (fields.title !== undefined) input.title = fields.title;
    if (fields.body !== undefined) {
        input.descriptionWidget = { description: fields.body };
    }
    if (fields.status !== undefined) {
        input.statusWidget = {
            status: await resolveStatus(config, fields.status),
        };
    }
    if (fields.assignee !== undefined) {
        const user = await resolveUser(config, fields.assignee);
        input.assigneesWidget = { assigneeIds: user ? [user.id] : [] };
    }

    const { add, remove } = await labelChanges(config, item, fields);
    if (add.length > 0 || remove.length > 0) {
        input.labelsWidget = {
            ...(add.length > 0 && { addLabelIds: add }),
            ...(remove.length > 0 && { removeLabelIds: remove }),
        };
    }

    if (fields.weight !== undefined) {
        const weight = orNone(fields.weight);
        input.weightWidget = {
            weight: weight === null ? null : Number(weight),
        };
    }
    if (fields.start !== undefined || fields.due !== undefined) {
        const current = getDates(item);
        input.startAndDueDateWidget = {
            isFixed: true,
            startDate:
                fields.start === undefined
                    ? current.startDate
                    : orNone(fields.start),
            dueDate:
                fields.due === undefined ? current.dueDate : orNone(fields.due),
        };
    }

    const timeTracking = buildTimeTrackingWidget(fields);
    if (timeTracking) input.timeTrackingWidget = timeTracking;
    return input;
}
