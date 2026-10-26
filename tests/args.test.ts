import { describe, expect, it } from 'bun:test';

import {
    csv,
    intFlag,
    itemStateFlag,
    oneOf,
    parseFlags,
    PROJECT,
} from '../src/cli/args.ts';
import { CliError } from '../src/errors.ts';

describe('parseFlags', () => {
    it('returns typed values and positionals', () => {
        const { values, positionals } = parseFlags(
            ['42', '--project', 'acme/app', '--label', 'a', '--label', 'b'],
            { ...PROJECT, label: { type: 'string', multiple: true } },
        );
        expect(values).toEqual({ project: 'acme/app', label: ['a', 'b'] });
        expect(positionals).toEqual(['42']);
    });

    it('rejects an unknown flag instead of ignoring it', () => {
        expect(() => parseFlags(['--asignee', 'bob'], PROJECT)).toThrow(
            CliError,
        );
    });
});

describe('intFlag', () => {
    it('uses the fallback and accepts positive integers', () => {
        expect(intFlag(undefined, 'limit', 50)).toBe(50);
        expect(intFlag('200', 'limit', 50)).toBe(200);
    });

    it('rejects zero, negatives and junk', () => {
        for (const bad of ['0', '-1', '1.5', 'abc', '']) {
            expect(() => intFlag(bad, 'limit', 50)).toThrow(/--limit/);
        }
    });
});

describe('oneOf / itemStateFlag', () => {
    it('checks the value against the allowed list', () => {
        expect(oneOf(undefined, 'sort', ['az', 'za'], 'az')).toBe('az');
        expect(oneOf('za', 'sort', ['az', 'za'], 'az')).toBe('za');
        expect(() => oneOf('up', 'sort', ['az', 'za'], 'az')).toThrow(
            '--sort must be one of: az, za',
        );
    });

    it('defaults state to opened and rejects GraphQL spelling', () => {
        expect(itemStateFlag(undefined)).toBe('opened');
        expect(() => itemStateFlag('OPEN')).toThrow(/--state/);
    });
});

describe('csv', () => {
    it('splits, trims and drops empties', () => {
        expect(csv(' a, b ,,c ')).toEqual(['a', 'b', 'c']);
        expect(csv(undefined)).toEqual([]);
    });
});
