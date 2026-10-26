import { parseArgs, type ParseArgsOptionsConfig } from 'node:util';

import { CliError, errorText } from '../errors.ts';

import type { ItemState } from '../api/work-items.ts';

/** Строгий разбор: опечатка во флаге — ошибка, а не молча проигнорированный флаг. */
export function parseFlags<const T extends ParseArgsOptionsConfig>(
    args: string[],
    options: T,
) {
    try {
        return parseArgs({
            args,
            options,
            allowPositionals: true,
            strict: true,
        });
    } catch (err) {
        throw new CliError(errorText(err));
    }
}

export const PROJECT = { project: { type: 'string' } } as const;
export const JSON_OUT = { json: { type: 'boolean' } } as const;
export const YES = { yes: { type: 'boolean' } } as const;

export function intFlag(
    value: string | undefined,
    name: string,
    fallback: number,
): number {
    if (value === undefined) return fallback;
    if (!/^\d+$/.test(value) || Number(value) === 0) {
        throw new CliError(
            `--${name} must be a positive integer, got "${value}"`,
        );
    }
    return Number(value);
}

export function oneOf<const T extends string>(
    value: string | undefined,
    name: string,
    allowed: readonly T[],
    fallback: T,
): T {
    if (value === undefined) return fallback;
    if (!(allowed as readonly string[]).includes(value)) {
        throw new CliError(`--${name} must be one of: ${allowed.join(', ')}`);
    }
    return value as T;
}

export function itemStateFlag(value: string | undefined): ItemState {
    return oneOf(value, 'state', ['opened', 'closed', 'all'], 'opened');
}

export function csv(value: string | undefined): string[] {
    return (
        value
            ?.split(',')
            .map((s) => s.trim())
            .filter(Boolean) ?? []
    );
}
