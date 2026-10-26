import { stdin, stdout } from 'node:process';
import { createInterface } from 'node:readline/promises';

import { chunk, dim } from '../format.ts';

async function ask(question: string): Promise<string> {
    const rl = createInterface({ input: stdin, output: stdout });
    try {
        return await rl.question(question);
    } finally {
        rl.close();
    }
}

// Без TTY ответ «нет»: скрипты и агенты обязаны передавать --yes явно.
export async function confirm(question: string): Promise<boolean> {
    if (!stdin.isTTY) return false;
    return (await ask(`${question} [y/N] `)).trim().toLowerCase() === 'y';
}

/** С `--yes` вопроса нет; отказ печатает «Aborted.». */
export async function confirmOrAbort(
    question: string,
    yes: boolean | undefined,
): Promise<boolean> {
    if (yes || (await confirm(question))) return true;
    console.log(dim('Aborted.'));
    return false;
}

export async function paged<T>(
    items: T[],
    perPage: number,
    render: (item: T) => void,
): Promise<void> {
    const pages = chunk(items, perPage);
    for (const [i, page] of pages.entries()) {
        page.forEach(render);
        if (i === pages.length - 1) break;
        const answer = await ask(
            dim(`-- page ${i + 1}/${pages.length} — Enter: next, q: quit -- `),
        );
        if (answer.trim().toLowerCase() === 'q') break;
    }
}
