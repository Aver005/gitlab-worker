import { describe, it, expect } from 'bun:test';

import { findScopedLabelConflicts } from '../src/api/labels.ts';

describe('findScopedLabelConflicts', () => {
    it('finds two labels in the same scope', () => {
        expect(
            findScopedLabelConflicts([
                'bug',
                'component::backend',
                'component::frontend',
            ]),
        ).toEqual([
            {
                scope: 'component',
                labels: ['component::backend', 'component::frontend'],
            },
        ]);
    });

    it('ignores plain labels and different scopes', () => {
        expect(
            findScopedLabelConflicts([
                'bug',
                'type::bug',
                'component::backend',
            ]),
        ).toEqual([]);
    });

    it('treats the same label repeated as no conflict', () => {
        expect(findScopedLabelConflicts(['type::bug', 'Type::Bug'])).toEqual(
            [],
        );
    });

    it('uses the text before the last :: as the scope', () => {
        expect(
            findScopedLabelConflicts(['a::b::c', 'a::b::d', 'a::x']),
        ).toEqual([{ scope: 'a::b', labels: ['a::b::c', 'a::b::d'] }]);
    });

    it('matches scopes case-insensitively', () => {
        expect(
            findScopedLabelConflicts(['Priority::high', 'priority::low']),
        ).toEqual([
            { scope: 'Priority', labels: ['Priority::high', 'priority::low'] },
        ]);
    });

    it('ignores labels starting with ::', () => {
        expect(findScopedLabelConflicts(['::a', '::b'])).toEqual([]);
    });
});
