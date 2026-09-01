import { getRetellApiKeyForChurch } from "@/lib/integrations/retell-key";

const RETELL_API_BASE = "https://api.retellai.com";

type RetellRequestOptions = {
  method: "GET" | "POST" | "PATCH";
  path: string;
  body?: Record<string, unknown>;
  /**
   * A linked church's agent can live in its own Retell account. When set,
   * that church's saved key (if any) is used instead of FaithForm's shared
   * `RETELL_API_KEY`. Omit for platform-level calls that have no church.
   */
  churchId?: string | null;
};

export class RetellApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "RetellApiError";
  }
}

/**
 * Resolves which Retell API key to sign a request with: the church's own
 * saved key when one exists, otherwise FaithForm's shared account key.
 * Returns `undefined` when neither is configured — callers decide whether
 * that is fatal (`retellRequest` throws; webhook verification just fails
 * closed).
 */
export async function resolveRetellApiKey(
  churchId?: string | null,
): Promise<string | undefined> {
  if (churchId) {
    const churchKey = await getRetellApiKeyForChurch(churchId);
    if (churchKey) return churchKey;
  }
  return process.env.RETELL_API_KEY;
}

export async function retellRequest<T>({
  method,
  path,
  body,
  churchId,
}: RetellRequestOptions): Promise<T> {
  const apiKey = await resolveRetellApiKey(churchId);
  if (!apiKey) {
    throw new Error("RETELL_API_KEY is not configured");
  }

  const response = await fetch(`${RETELL_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  if (!response.ok) {
    throw new RetellApiError(
      `Retell API ${method} ${path} failed`,
      response.status,
      text,
    );
  }

  return text ? (JSON.parse(text) as T) : ({} as T);
}

export type RetellLlmResponse = {
  llm_id: string;
  version?: number;
  is_published?: boolean;
};

export type RetellAgentResponse = {
  agent_id: string;
  version?: number;
  is_published?: boolean;
  base_version?: number | null;
  response_engine?: {
    type?: string;
    llm_id?: string;
    version?: number;
  };
};

export type RetellAgentSummary = {
  agentId: string;
  agentName: string | null;
  version: number | null;
  isPublished: boolean;
};

type RetellAgentListRow = {
  agent_id?: string;
  agent_name?: string | null;
  /**
   * Only present once an agent has been published at least once — a
   * never-published draft omits the field entirely, which is how a draft is
   * told apart from a live agent now that rows are per agent, not per version.
   */
  latest_published_version?: number | null;
};

type RetellAgentListPage = {
  items?: RetellAgentListRow[];
  has_more?: boolean;
  pagination_key?: string | null;
};

/** Retell's documented maximum page size for `POST /v2/list-agents`. */
const RETELL_AGENT_PAGE_LIMIT = 1000;

/** Backstop so a misbehaving `has_more` cannot spin this forever. */
const RETELL_AGENT_PAGE_CAP = 20;

/**
 * Lists the voice agents on whichever Retell account serves this church — its
 * own saved key when it has one, otherwise FaithForm's shared account.
 *
 * Uses `POST /v2/list-agents`, which replaced the retired `GET /list-agents`.
 * The v2 endpoint returns one row per agent rather than one per agent
 * *version* (4 rows instead of 143 on the shared account), so there is nothing
 * left to collapse, and its `pagination_key` actually works — chat agents,
 * which the old voice-only endpoint never returned, are filtered out to keep
 * the picker showing the same set of agents as before.
 */
export async function listRetellAgents(
  churchId?: string | null,
): Promise<RetellAgentSummary[]> {
  const rows: RetellAgentListRow[] = [];
  let paginationKey: string | undefined;

  for (let page = 0; page < RETELL_AGENT_PAGE_CAP; page += 1) {
    const query = new URLSearchParams({
      limit: String(RETELL_AGENT_PAGE_LIMIT),
    });
    if (paginationKey) query.set("pagination_key", paginationKey);

    const response = await retellRequest<RetellAgentListPage>({
      method: "POST",
      path: `/v2/list-agents?${query.toString()}`,
      body: {
        filter_criteria: {
          channel: { type: "string", op: "eq", value: "voice" },
        },
      },
      churchId,
    });

    if (Array.isArray(response?.items)) rows.push(...response.items);
    if (!response?.has_more || !response.pagination_key) break;
    paginationKey = response.pagination_key;
  }

  return rows
    .filter(
      (row): row is RetellAgentListRow & { agent_id: string } =>
        Boolean(row?.agent_id),
    )
    .map((row) => ({
      agentId: row.agent_id,
      agentName: row.agent_name?.trim() || null,
      version: row.latest_published_version ?? null,
      isPublished: typeof row.latest_published_version === "number",
    }))
    .sort((a, b) =>
      (a.agentName ?? a.agentId).localeCompare(b.agentName ?? b.agentId),
    );
}
