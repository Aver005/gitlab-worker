import { describe, expect, it } from 'bun:test';

import { checkPayload, optionalArgs, paginate } from '../src/api/client.ts';

describe('optionalArgs', () => {
    it('keeps only defined arguments, with a leading comma', () => {
        expect(
            optionalArgs([
                ['state', 'IssuableState', 'opened'],
                ['search', 'String', undefined],
                ['labelName', '[String!]', ['bug']],
            ]),
        ).toEqual({
            args: ', state: $state, labelName: $labelName',
            params: ', $state: IssuableState, $labelName: [String!]',
            variables: { state: 'opened', labelName: ['bug'] },
        });
    });

    it('gives empty strings when nothing is set', () => {
        expect(optionalArgs([['search', 'String', undefined]])).toEqual({
            args: '',
            params: '',
            variables: {},
        });
    });
});

const pageOf = (from: number, count: number, hasNext: boolean) => ({
    pageInfo: {
        hasNextPage: hasNext,
        endCursor: hasNext ? `c${from}` : null,
    },
    nodes: Array.from({ length: count }, (_, i) => from + i),
});

describe('paginate', () => {
    it('asks for at most 100 per page and stops at the limit', async () => {
        const asked: Array<[number, string | null]> = [];
        const result = await paginate(250, async (first, after) => {
            asked.push([first, after]);
            return pageOf(asked.length * 100, first, true);
        });
        expect(asked).toEqual([
            [100, null],
            [100, 'c100'],
            [50, 'c200'],
        ]);
        expect(result).toHaveLength(250);
    });

    it('stops on the last page and on a null page', async () => {
        let calls = 0;
        expect(
            await paginate(500, async () =>
                ++calls === 1 ? pageOf(0, 3, false) : null,
            ),
        ).toEqual([0, 1, 2]);
        expect(calls).toBe(1);
        expect(await paginate(10, async () => null)).toEqual([]);
    });
});

describe('checkPayload', () => {
    it('passes a clean payload through and throws on errors', () => {
        const ok = { errors: [], todo: 1 };
        expect(checkPayload(ok, 'mark to-do done')).toBe(ok);
        expect(() =>
            checkPayload({ errors: ['a', 'b'] }, 'mark to-do done'),
        ).toThrow('Failed to mark to-do done: a; b');
    });
});
