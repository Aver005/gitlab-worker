import { gql } from './client.ts';
import {
    mutatedItem,
    type MutationWorkItem,
    type WorkItemPayload,
} from './work-items.ts';

import type { Config } from '../config/load.ts';

// Связи — отдельные мутации, а не виджет workItemUpdate. linkType описывает
// связь ОТ `id` К каждому из `workItemsIds`.
export type LinkType = 'RELATED' | 'BLOCKS' | 'BLOCKED_BY';

export async function addLinkedItems(
    config: Config,
    id: string,
    workItemsIds: string[],
    linkType: LinkType,
): Promise<MutationWorkItem> {
    const data = await gql<{ workItemAddLinkedItems: WorkItemPayload }>(
        config,
        `mutation ($input: WorkItemAddLinkedItemsInput!) {
            workItemAddLinkedItems(input: $input) {
                workItem { id iid title state webUrl }
                errors
                message
            }
        }`,
        { input: { id, workItemsIds, linkType } },
    );
    return mutatedItem(data.workItemAddLinkedItems, 'link work items');
}

export async function removeLinkedItems(
    config: Config,
    id: string,
    workItemsIds: string[],
): Promise<MutationWorkItem> {
    const data = await gql<{ workItemRemoveLinkedItems: WorkItemPayload }>(
        config,
        `mutation ($input: WorkItemRemoveLinkedItemsInput!) {
            workItemRemoveLinkedItems(input: $input) {
                workItem { id iid title state webUrl }
                errors
                message
            }
        }`,
        { input: { id, workItemsIds } },
    );
    return mutatedItem(data.workItemRemoveLinkedItems, 'unlink work items');
}

const LINK_TYPES: Record<string, LinkType> = {
    related: 'RELATED',
    relates: 'RELATED',
    relate: 'RELATED',
    rel: 'RELATED',
    blocks: 'BLOCKS',
    block: 'BLOCKS',
    blocking: 'BLOCKS',
    'blocked-by': 'BLOCKED_BY',
    blockedby: 'BLOCKED_BY',
    'is-blocked-by': 'BLOCKED_BY',
    blocked: 'BLOCKED_BY',
};

/** Пробелы, подчёркивания и дефисы в названии типа взаимозаменяемы. */
export function parseLinkType(input: string): LinkType {
    const key = input
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/g, '-');
    const type = LINK_TYPES[key];
    if (!type) {
        throw new Error(
            `Invalid link type "${input}". Use: related, blocks, blocked-by`,
        );
    }
    return type;
}
