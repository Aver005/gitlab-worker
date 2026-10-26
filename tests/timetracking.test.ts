import { describe, it, expect } from 'bun:test';

import {
    buildTimeTrackingWidget,
    parseSpentDate,
    isIsoDate,
} from '../src/api/time-tracking.ts';

describe('buildTimeTrackingWidget', () => {
    it('returns undefined when nothing is set', () => {
        expect(buildTimeTrackingWidget({})).toBeUndefined();
        expect(buildTimeTrackingWidget({ spendSummary: 'x' })).toBeUndefined();
    });

    it('puts estimate and spend into one widget', () => {
        expect(
            buildTimeTrackingWidget({
                estimate: '3h',
                spend: '1h30m',
                spendSummary: 'review',
            }),
        ).toEqual({
            timeEstimate: '3h',
            timelog: { timeSpent: '1h30m', summary: 'review' },
        });
    });

    it('omits an empty summary', () => {
        expect(buildTimeTrackingWidget({ spend: '2h' })).toEqual({
            timelog: { timeSpent: '2h' },
        });
    });

    it('validates durations', () => {
        expect(() =>
            buildTimeTrackingWidget({ estimate: 'two hours' }),
        ).toThrow();
        expect(() => buildTimeTrackingWidget({ spend: '1x' })).toThrow();
    });

    it('adds spentAt when a spend date is given', () => {
        expect(
            buildTimeTrackingWidget({ spend: '4h', spendDate: '2026-10-15' }),
        ).toEqual({
            timelog: { timeSpent: '4h', spentAt: '2026-10-15T12:00:00Z' },
        });
    });

    it('rejects a spend date without a duration', () => {
        expect(() =>
            buildTimeTrackingWidget({ spendDate: '2026-10-15' }),
        ).toThrow(/without a duration/);
        expect(() =>
            buildTimeTrackingWidget({
                estimate: '2h',
                spendDate: '2026-10-15',
            }),
        ).toThrow();
    });
});

describe('parseSpentDate', () => {
    it('returns noon UTC for a valid date', () => {
        expect(parseSpentDate('2026-01-31')).toBe('2026-01-31T12:00:00Z');
        expect(parseSpentDate(' 2024-02-29 ')).toBe('2024-02-29T12:00:00Z');
    });

    it('rejects malformed and impossible dates', () => {
        for (const bad of [
            '2026-1-5',
            '15.10.2026',
            '2026-02-30',
            '2025-02-29',
            '2026-13-01',
            'today',
            '',
        ]) {
            expect(() => parseSpentDate(bad)).toThrow(/YYYY-MM-DD/);
        }
    });
});

describe('isIsoDate', () => {
    it('accepts real calendar days only', () => {
        expect(isIsoDate('2026-10-19')).toBe(true);
        expect(isIsoDate('2024-02-29')).toBe(true);
        expect(isIsoDate('2025-02-29')).toBe(false);
        expect(isIsoDate('2026-10-1')).toBe(false);
        expect(isIsoDate(' 2026-10-19')).toBe(false);
    });
});
