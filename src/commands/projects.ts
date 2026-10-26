import { listProjects } from '../api/projects.ts';
import { writeProjectsCache } from '../cache.ts';
import { intFlag, JSON_OUT, oneOf, parseFlags } from '../cli/args.ts';
import { connection } from '../cli/context.ts';
import { printJson } from '../cli/output.ts';
import { paged } from '../cli/prompt.ts';
import { cyan, dim, green } from '../format.ts';

import type { ProjectInfo } from '../api/projects.ts';
import type { Command } from '../cli/command.ts';

export const projects: Command = {
    name: 'projects',
    aliases: ['p'],
    synopsis: 'projects',
    summary: 'List projects you are a member of',
    help: () => `
glw projects [--search <q>] [--limit <n>] [--per-page <n>] [--sort az|za] [--paginate|--no-paginate] [--json]

List projects you are a member of (id, full path, name).

Flags:
  --search <q>      Filter by name
  --limit <n>       Max total to fetch (default: 100)
  --per-page <n>    Page size for interactive paging (default: 30)
  --sort az|za      Sort by fullPath: az (default) or za; also accepts asc/desc
  --paginate        Force interactive paging (TTY only)
  --no-paginate     Disable interactive paging
  --json            JSON output (never paginates)
`,
    async run(args) {
        const { values } = parseFlags(args, {
            search: { type: 'string' },
            limit: { type: 'string' },
            'per-page': { type: 'string' },
            sort: { type: 'string' },
            paginate: { type: 'boolean' },
            'no-paginate': { type: 'boolean' },
            ...JSON_OUT,
        });
        const perPage = intFlag(values['per-page'], 'per-page', 30);
        const sort = oneOf(
            values.sort?.toLowerCase(),
            'sort',
            ['az', 'za', 'asc', 'desc'],
            'az',
        );
        const desc = sort === 'za' || sort === 'desc';

        const config = connection();
        const found = await listProjects(config, {
            search: values.search,
            limit: intFlag(values.limit, 'limit', 100),
        });
        writeProjectsCache(found.map((p) => p.fullPath));

        const sorted = found.toSorted((a, b) => {
            const cmp = a.fullPath
                .toLowerCase()
                .localeCompare(b.fullPath.toLowerCase());
            return desc ? -cmp : cmp;
        });

        if (values.json) {
            printJson(sorted);
            return;
        }
        if (sorted.length === 0) {
            console.log(dim('No projects found.'));
            return;
        }

        const render = (p: ProjectInfo) => {
            const marker = p.fullPath === config.project ? green(' *') : '';
            console.log(`${cyan(p.fullPath)} ${dim(`— ${p.name}`)}${marker}`);
        };
        const shouldPage =
            !values['no-paginate'] &&
            (values.paginate ||
                (process.stdout.isTTY && sorted.length > perPage));

        if (shouldPage) await paged(sorted, perPage, render);
        else sorted.forEach(render);
    },
};
