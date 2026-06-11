const RETELL_API_BASE = "https://api.retellai.com";

type RetellRequestOptions = {
  method: "GET" | "POST" | "PATCH";
  path: string;
  body?: Record<string, unknown>;
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

function getRetellApiKey(): string {
  const key = process.env.RETELL_API_KEY;
  if (!key) {
    throw new Error("RETELL_API_KEY is not configured");
  }
  return key;
}

export async function retellRequest<T>({
  method,
  path,
  body,
}: RetellRequestOptions): Promise<T> {
  const response = await fetch(`${RETELL_API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${getRetellApiKey()}`,
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
};

export type RetellAgentResponse = {
  agent_id: string;
};
