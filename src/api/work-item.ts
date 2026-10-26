/** Узел задачи в том виде, в каком его отдаёт GraphQL, и чтение виджетов. */

export interface UserRef {
    id: string;
    username: string;
    name: string;
}

export interface LabelRef {
    id: string;
    title: string;
}

export interface HierarchyRef {
    id: string;
    iid: string;
    title: string;
    state: string;
}

type Widget =
    | { type: 'DESCRIPTION'; description: string }
    | { type: 'ASSIGNEES'; assignees: { nodes: UserRef[] } }
    | { type: 'LABELS'; labels: { nodes: LabelRef[] } }
    | { type: 'STATUS'; status: { id: string; name: string } | null }
    | { type: 'WEIGHT'; weight: number | null }
    | {
          type: 'START_AND_DUE_DATE';
          startDate: string | null;
          dueDate: string | null;
      }
    | { type: 'TIME_TRACKING'; timeEstimate: number; totalTimeSpent: number }
    | {
          type: 'HIERARCHY';
          hasParent: boolean;
          hasChildren: boolean;
          parent: HierarchyRef | null;
          children: { nodes: HierarchyRef[] };
      }
    | {
          type: 'LINKED_ITEMS';
          blocked: boolean;
          blockedByCount: number;
          blockingCount: number;
      };

export interface WorkItemNode {
    id: string;
    iid: string;
    title: string;
    state: string;
    webUrl: string;
    namespace?: { fullPath: string } | null;
    widgets: Widget[];
}

function widget<K extends Widget['type']>(
    item: WorkItemNode,
    type: K,
): Extract<Widget, { type: K }> | undefined {
    return item.widgets.find(
        (w): w is Extract<Widget, { type: K }> => w.type === type,
    );
}

export function getDescription(item: WorkItemNode): string {
    return widget(item, 'DESCRIPTION')?.description ?? '';
}

export function getAssignees(item: WorkItemNode): UserRef[] {
    return widget(item, 'ASSIGNEES')?.assignees.nodes ?? [];
}

export function getLabels(item: WorkItemNode): LabelRef[] {
    return widget(item, 'LABELS')?.labels.nodes ?? [];
}

export function getStatus(
    item: WorkItemNode,
): { id: string; name: string } | null {
    return widget(item, 'STATUS')?.status ?? null;
}

export function getWeight(item: WorkItemNode): number | null {
    return widget(item, 'WEIGHT')?.weight ?? null;
}

export function getDates(item: WorkItemNode): {
    startDate: string | null;
    dueDate: string | null;
} {
    const w = widget(item, 'START_AND_DUE_DATE');
    return { startDate: w?.startDate ?? null, dueDate: w?.dueDate ?? null };
}

export function getTimeTracking(item: WorkItemNode): {
    timeEstimate: number;
    totalTimeSpent: number;
} {
    const w = widget(item, 'TIME_TRACKING');
    return {
        timeEstimate: w?.timeEstimate ?? 0,
        totalTimeSpent: w?.totalTimeSpent ?? 0,
    };
}

export function getHierarchy(item: WorkItemNode): {
    parent: HierarchyRef | null;
    children: HierarchyRef[];
} {
    const w = widget(item, 'HIERARCHY');
    return { parent: w?.parent ?? null, children: w?.children.nodes ?? [] };
}

export function getLinkedInfo(item: WorkItemNode): {
    blockedByCount: number;
    blockingCount: number;
} {
    const w = widget(item, 'LINKED_ITEMS');
    return {
        blockedByCount: w?.blockedByCount ?? 0,
        blockingCount: w?.blockingCount ?? 0,
    };
}

/** «#42» и «42» — одно и то же; всё, кроме цифр, — ошибка. */
export function normalizeIid(input: string): string {
    const s = input.trim().replace(/^#/, '');
    if (!/^\d+$/.test(s)) {
        throw new Error(
            `Invalid issue number "${input}". Expected a number like 42 or #42`,
        );
    }
    return s;
}

export function hasAssignee(item: WorkItemNode, username: string): boolean {
    const name = username.toLowerCase();
    return getAssignees(item).some((a) => a.username.toLowerCase() === name);
}

export function hasLabel(item: WorkItemNode, title: string): boolean {
    const t = title.toLowerCase();
    return getLabels(item).some((l) => l.title.toLowerCase() === t);
}

export interface SearchCriteria {
    text?: string;
    name?: string;
    body?: string;
    /** YYYY-MM-DD */
    startTime?: string;
}

/** Все заданные условия через AND; без регистра. */
export function matchesSearch(
    item: { title: string; description: string; startDate: string | null },
    criteria: SearchCriteria,
): boolean {
    const title = item.title.toLowerCase();
    const description = item.description.toLowerCase();
    const { text, name, body, startTime } = criteria;

    if (text !== undefined) {
        const t = text.toLowerCase();
        if (!title.includes(t) && !description.includes(t)) return false;
    }
    if (name !== undefined && !title.includes(name.toLowerCase())) {
        return false;
    }
    if (body !== undefined && !description.includes(body.toLowerCase())) {
        return false;
    }
    if (startTime !== undefined) {
        if (!item.startDate || item.startDate < startTime) return false;
    }
    return true;
}
