import { describe, it, expect } from "bun:test";
import { flattenTodo, todoRef, toTodoGid, type TodoNode } from "../src/api.ts";

const base: TodoNode = {
  id: "gid://gitlab/Todo/1201",
  action: "assigned",
  body: "Login page",
  state: "pending",
  createdAt: "2026-10-20T09:15:00Z",
  targetType: "WORKITEM",
  targetUrl: "https://gitlab.example.com/acme/app/-/work_items/42",
  author: { username: "bob" },
  project: { fullPath: "acme/app" },
  group: null,
  targetEntity: {
    name: "Login page",
    webUrl: "https://gitlab.example.com/acme/app/-/work_items/42",
    iid: "42",
    workItemState: "OPEN",
  },
};

describe("toTodoGid", () => {
  it("accepts a number or a full gid", () => {
    expect(toTodoGid("1201")).toBe("gid://gitlab/Todo/1201");
    expect(toTodoGid(" gid://gitlab/Todo/7 ")).toBe("gid://gitlab/Todo/7");
  });

  it("rejects anything else", () => {
    expect(() => toTodoGid("#42")).toThrow(/Invalid to-do id/);
    expect(() => toTodoGid("gid://gitlab/Issue/7")).toThrow(/Invalid to-do id/);
  });
});

describe("todoRef", () => {
  it("uses the GitLab sigil of the target type", () => {
    expect(todoRef("WORKITEM", "acme/app", "42")).toBe("acme/app#42");
    expect(todoRef("ISSUE", "acme/app", "42")).toBe("acme/app#42");
    expect(todoRef("MERGEREQUEST", "acme/app", "7")).toBe("acme/app!7");
    expect(todoRef("EPIC", "acme", "3")).toBe("acme&3");
  });

  it("falls back to the path when the target has no iid", () => {
    expect(todoRef("DESIGN", "acme/app", undefined)).toBe("acme/app");
    expect(todoRef("KEY", null, undefined)).toBe("");
  });
});

describe("flattenTodo", () => {
  it("flattens a work item to-do", () => {
    expect(flattenTodo(base)).toEqual({
      id: "1201",
      action: "assigned",
      state: "pending",
      type: "WORKITEM",
      project: "acme/app",
      ref: "acme/app#42",
      title: "Login page",
      targetState: "open",
      author: "bob",
      createdAt: "2026-10-20T09:15:00Z",
      url: "https://gitlab.example.com/acme/app/-/work_items/42",
      body: "Login page",
    });
  });

  it("reads the aliased merge request state", () => {
    const mr = flattenTodo({
      ...base,
      targetType: "MERGEREQUEST",
      targetEntity: { name: "Fix auth", webUrl: null, iid: "7", mrState: "merged" },
    });
    expect(mr.ref).toBe("acme/app!7");
    expect(mr.targetState).toBe("merged");
    expect(mr.url).toBe(base.targetUrl);
  });

  it("survives a null target and a group-level to-do", () => {
    const t = flattenTodo({
      ...base,
      targetType: "EPIC",
      project: null,
      group: { fullPath: "acme" },
      author: null,
      targetEntity: null,
    });
    expect(t.project).toBe("acme");
    expect(t.ref).toBe("acme");
    expect(t.title).toBe("Login page");
    expect(t.targetState).toBeNull();
    expect(t.author).toBeNull();
  });
});
