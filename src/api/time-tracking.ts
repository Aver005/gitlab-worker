/** Проверка длительностей и дат и сборка виджета учёта времени. */

export interface TimeTrackingWidgetInput {
    timeEstimate?: string;
    timelog?: { timeSpent: string; spentAt?: string; summary?: string };
}

export interface TimeTrackingFields {
    estimate?: string;
    spend?: string;
    spendDate?: string;
    spendSummary?: string;
}

const DURATION_RE = /^(\d+[wdhm]\s*)+$/i;

export function validateDuration(dur: string): string {
    const trimmed = dur.trim();
    if (!DURATION_RE.test(trimmed)) {
        throw new Error(
            `Invalid duration "${dur}". Use format like "2h", "1h30m", "3d", "1w2d3h"`,
        );
    }
    return trimmed;
}

/** Строгий YYYY-MM-DD, который ещё и существует в календаре. */
export function isIsoDate(s: string): boolean {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return false;
    const date = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
    return date.toISOString().slice(0, 10) === s;
}

/** Полдень UTC, чтобы день списания не съезжал ни в одном часовом поясе. */
export function parseSpentDate(input: string): string {
    const s = input.trim();
    if (!isIsoDate(s)) {
        throw new Error(
            `Invalid date "${input}". Use YYYY-MM-DD, e.g. 2026-10-15`,
        );
    }
    return `${s}T12:00:00Z`;
}

/** Оценка и списание обязаны идти одним виджетом, иначе одно затирает другое. */
export function buildTimeTrackingWidget(
    fields: TimeTrackingFields,
): TimeTrackingWidgetInput | undefined {
    if (fields.spendDate !== undefined && fields.spend === undefined) {
        throw new Error(
            'Spend date given without a duration to log (--spend or "spend:")',
        );
    }
    if (fields.estimate === undefined && fields.spend === undefined) {
        return undefined;
    }

    const widget: TimeTrackingWidgetInput = {};
    if (fields.estimate !== undefined) {
        widget.timeEstimate = validateDuration(fields.estimate);
    }
    if (fields.spend !== undefined) {
        widget.timelog = { timeSpent: validateDuration(fields.spend) };
        if (fields.spendDate !== undefined) {
            widget.timelog.spentAt = parseSpentDate(fields.spendDate);
        }
        if (fields.spendSummary) widget.timelog.summary = fields.spendSummary;
    }
    return widget;
}
