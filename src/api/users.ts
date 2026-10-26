import { gql } from './client.ts';

import type { Config } from '../config/load.ts';
import type { UserRef } from './work-item.ts';

const idByUsername = new Map<string, string>();
let currentUser: UserRef | null = null;

export async function getCurrentUser(config: Config): Promise<UserRef> {
    if (currentUser) return currentUser;

    const data = await gql<{ currentUser: UserRef | null }>(
        config,
        'query { currentUser { id username name } }',
    );
    if (!data.currentUser) {
        throw new Error(
            'Could not fetch current user. Check your access token.',
        );
    }
    currentUser = data.currentUser;
    return currentUser;
}

/** `@me` — текущий пользователь, ведущая `@` у имени необязательна. */
export async function resolveUsername(
    config: Config,
    input: string,
): Promise<string> {
    if (input === '@me') return (await getCurrentUser(config)).username;
    return input.startsWith('@') ? input.slice(1) : input;
}

/** `none` означает «снять исполнителя» и даёт `null`. */
export async function resolveUser(
    config: Config,
    input: string,
): Promise<{ id: string; username: string } | null> {
    if (input === 'none') return null;
    if (input === '@me') return getCurrentUser(config);

    const username = await resolveUsername(config, input);
    const key = username.toLowerCase();
    const cached = idByUsername.get(key);
    if (cached) return { id: cached, username };

    const data = await gql<{
        users: { nodes: Array<{ id: string; username: string }> };
    }>(
        config,
        `query ($usernames: [String!]) {
            users(usernames: $usernames) { nodes { id username } }
        }`,
        { usernames: [username] },
    );

    const node = data.users.nodes[0];
    if (!node) throw new Error(`User not found: "${username}"`);
    idByUsername.set(key, node.id);
    return node;
}
