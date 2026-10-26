import { resolveProjectId, resolveProjectPath } from '../api/projects.ts';
import {
    flattenTodo,
    listTodos,
    markAllTodosDone,
    markTodoDone,
    toTodoGid,
    type FlatTodo,
} from '../api/todos.ts';
import {
    intFlag,
    JSON_OUT,
    oneOf,
    PROJECT,
    parseFlags,
    YES,
} from '../cli/args.ts';
import { connection } from '../cli/context.ts';
import { forEachItem, printJson, printTableRows } from '../cli/output.ts';
import { confirmOrAbort } from '../cli/prompt.ts';
import { CliError } from '../errors.ts';
import { formatFieldTable } from '../fields.ts';
import { bold, cyan, dim, green, isOpenState, yellow } from '../format.ts';

import type { Command } from '../cli/command.ts';
import type { Config } from '../config/load.ts';

function printTodos(todos: FlatTodo[], withState: boolean): void {
    if (todos.length === 0) {
        console.log(dim('To-Do List is empty.'));
        return;
    }
    const columns = ['id', 'action', 'target', 'title', 'author', 'created'];
    if (withState) columns.splice(2, 0, 'state');
    const rows = todos.map((t) => ({
        id: t.id,
        action: t.action,
        state: t.state,
        target:
            t.targetState && !isOpenState(t.targetState)
                ? `${t.ref} (${t.targetState})`
                : t.ref,
        title: t.title,
        author: t.author && `@${t.author}`,
        created: t.createdAt.slice(0, 10),
    }));
    printTableRows(formatFieldTable(rows, columns));
}

async function markAll(
    config: Config,
    projectId: string | undefined,
    flags: { yes?: boolean; json?: boolean },
): Promise<void> {
    const pending = (
        await listTodos(config, { state: 'pending', projectId, limit: 1000 })
    ).map(flattenTodo);
    if (pending.length === 0) {
        console.log(dim('No pending to-dos.'));
        return;
    }
    if (!flags.yes) {
        console.log(
            `\nFound ${yellow(String(pending.length))} pending to-do(s):\n`,
        );
        for (const t of pending) {
            console.log(
                `  ${dim(t.id)} ${t.action} ${cyan(t.ref)} ${bold(t.title)}`,
            );
        }
        console.log();
    }
    const question = `Mark ${pending.length} to-do(s) done?`;
    if (!(await confirmOrAbort(question, flags.yes))) return;

    const count = await markAllTodosDone(config, projectId);
    if (flags.json) printJson({ done: count });
    else console.log(`${green('Marked done:')} ${count} to-do(s)`);
}

async function markSome(
    config: Config,
    ids: string[],
    json: boolean | undefined,
): Promise<void> {
    if (ids.length === 0) {
        throw new CliError(
            'Usage: glw todos done <id...> | glw todos done --all',
        );
    }
    const gids = new Map(ids.map((id) => [id, toTodoGid(id)]));
    const failures = await forEachItem(
        ids,
        (id) => id,
        async (id) => {
            await markTodoDone(config, gids.get(id)!);
            if (!json) console.log(`${green('Done')} ${cyan(id)}`);
        },
    );
    if (json) {
        const failed = new Map(failures.map((f) => [f.item, f.error]));
        printJson(
            ids.map((id) =>
                failed.has(id) ? { id, error: failed.get(id) } : { id },
            ),
        );
    }
}

export const todos: Command = {
    name: 'todos',
    synopsis: 'todos [done <id...>]',
    summary: 'My GitLab To-Do List; mark items done',
    help: () => `
glw todos [--state pending|done|all] [--project <ref>] [--limit <n>] [--json]
glw todos done <id...>
glw todos done --all [--project <ref>] [--yes]

Your GitLab To-Do List: what you were assigned, mentioned in, asked to review.
Not tied to the default project; --project narrows to one project.

Flags:
  --state <s>       pending | done | all (default: pending)
  --project <ref>   Only to-dos of this project
  --limit <n>       Max results (default: 100)
  --json            JSON output: flat objects { id, action, state, type,
                    project, ref, title, targetState, author, createdAt, url, body }

done:
  <id...>           Mark these to-dos done (ids from the ID column)
  --all             Mark every pending to-do done (with --project: of that project)
  --yes             Skip confirmation for --all

Examples:
  glw todos
  glw todos --project backend-api --json
  glw todos done 1201 1202
  glw todos done --all --yes
`,
    async run(args) {
        const { values, positionals } = parseFlags(args, {
            ...PROJECT,
            state: { type: 'string' },
            limit: { type: 'string' },
            all: { type: 'boolean' },
            ...YES,
            ...JSON_OUT,
        });
        const [sub, ...ids] = positionals;
        if (sub !== undefined && sub !== 'done') {
            throw new CliError(
                `Unknown todos subcommand: "${sub}". Run: glw todos --help`,
            );
        }
        const state = oneOf(
            values.state,
            'state',
            ['pending', 'done', 'all'],
            'pending',
        );
        const limit = intFlag(values.limit, 'limit', 100);

        const config = connection();
        const projectId = values.project
            ? await resolveProjectId(
                  config,
                  await resolveProjectPath(config, values.project),
              )
            : undefined;

        if (sub === 'done') {
            if (values.all && ids.length > 0) {
                throw new CliError('Pass either to-do ids or --all, not both');
            }
            if (values.all) await markAll(config, projectId, values);
            else await markSome(config, ids, values.json);
            return;
        }

        const found = (
            await listTodos(config, { state, projectId, limit })
        ).map(flattenTodo);
        if (values.json) printJson(found);
        else printTodos(found, state !== 'pending');
    },
};
