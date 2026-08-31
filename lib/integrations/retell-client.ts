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
  version?: number | null;
  is_published?: boolean;
};

/**
 * Lists the agents on whichever Retell account serves this church — its own
 * saved key when it has one, otherwise FaithForm's shared account.
 *
 * `GET /list-agents` returns one row per agent *version*, not one per agent
 * (143 rows for 4 real agents on the shared account), and `pagination_key`
 * responds 500, so this asks for a single oversized page and collapses it to
 * the newest version of each distinct `agent_id`.
 */
export async function listRetellAgents(
  churchId?: string | null,
): Promise<RetellAgentSummary[]> {
  const rows = await retellRequest<RetellAgentListRow[]>({
    method: "GET",
    path: "/list-agents?limit=1000",
    churchId,
  });

  if (!Array.isArray(rows)) return [];

  const newest = new Map<string, RetellAgentListRow>();
  for (const row of rows) {
    if (!row?.agent_id) continue;
    const seen = newest.get(row.agent_id);
    if (!seen || (row.version ?? 0) > (seen.version ?? 0)) {
      newest.set(row.agent_id, row);
    }
  }

  return [...newest.values()]
    .map((row) => ({
      agentId: row.agent_id as string,
      agentName: row.agent_name?.trim() || null,
      version: row.version ?? null,
      isPublished: row.is_published === true,
    }))
    .sort((a, b) =>
      (a.agentName ?? a.agentId).localeCompare(b.agentName ?? b.agentId),
    );
}
