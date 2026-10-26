/** Ошибка пользователя: печатается одной строкой, без стека. */
export class CliError extends Error {}

export function errorText(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
