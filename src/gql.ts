import type { Config } from "./config.ts";

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; locations?: unknown; path?: unknown }>;
}

export async function gql<T = unknown>(
  config: Config,
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const endpoint = `${config.url}/api/graphql`;

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.token}`,
      },
      body: JSON.stringify({ query, variables }),
    });
  } catch (err) {
    throw new Error(
      `Network error connecting to ${endpoint}: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!response.ok) {
    let body = "";
    try {
      body = await response.text();
    } catch {
      // ignore
    }
    throw new Error(
      `GitLab API HTTP ${response.status} ${response.statusText}${body ? `\n${body.slice(0, 500)}` : ""}`
    );
  }

  let json: GraphQLResponse<T>;
  try {
    json = (await response.json()) as GraphQLResponse<T>;
  } catch {
    throw new Error(`Failed to parse GitLab API response as JSON`);
  }

  if (json.errors && json.errors.length > 0) {
    const messages = json.errors.map((e) => e.message).join("; ");
    throw new Error(`GitLab GraphQL error: ${messages}`);
  }

  if (json.data === undefined) {
    throw new Error(`GitLab API returned no data`);
  }

  return json.data;
}
