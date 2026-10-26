import { resolveProjectPath } from '../api/projects.ts';
import { loadConfig, type Config } from '../config/load.ts';

/** Подключение без проекта: для команд, которым он не нужен. */
export function connection(): Config {
    return loadConfig(undefined, false);
}

/** `--project` без «/» — короткое имя, его сначала ищем среди проектов пользователя. */
export async function projectConfig(project?: string): Promise<Config> {
    if (project && !project.includes('/')) {
        const conn = connection();
        return { ...conn, project: await resolveProjectPath(conn, project) };
    }
    return loadConfig(project);
}
