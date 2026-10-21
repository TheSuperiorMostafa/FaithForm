import { absoluteAppPath } from "@/lib/site-url";

/** Server-side integration. Never import this module from a client component. */
export type NotionSupportTicket = {
  id: string;
  churchName: string;
  subject: string;
  body: string | null;
  priority: string;
};

const API_ROOT = "https://api.notion.com/v1";
const API_VERSION = "2025-09-03";
const TICKET_ID_PROPERTY = "FaithForm Ticket ID";
const PRIORITIES: Record<string, string> = {
  low: "Low", normal: "Normal", high: "High", urgent: "Urgent",
};

export function isNotionSupportConfigured(): boolean {
  return Boolean(process.env.NOTION_API_KEY?.trim() && process.env.NOTION_SUPPORT_DATA_SOURCE_ID?.trim());
}

// Notion limits each rich-text segment to 2,000 characters. Preserve Unicode
// pairs and the entire message, including whitespace, rather than truncating.
function textParts(value: string, size = 2000): string[] {
  const parts: string[] = [];
  for (let start = 0; start < value.length;) {
    let end = Math.min(start + size, value.length);
    const last = value.charCodeAt(end - 1);
    if (end < value.length && last >= 0xd800 && last <= 0xdbff) end--;
    parts.push(value.slice(start, end));
    start = end;
  }
  return parts;
}

function richText(value: string) {
  const parts = textParts(value);
  if (parts.length > 100) throw new Error("notion_text_too_long");
  return parts.map((content) => ({ type: "text", text: { content } }));
}

type NotionResult = {
  id?: string;
  results?: Array<{ id: string; rich_text?: Array<{ plain_text?: string; text?: { content?: string } }> }>;
  has_more?: boolean;
  next_cursor?: string | null;
};

/**
 * Recover a page/comment after ambiguous timeouts before writing again. Existing
 * pages keep the team's assignment, priority and build status on every retry.
 * The outbox's database lease serializes callers for the same ticket.
 */
export async function syncNotionTicket(
  ticket: NotionSupportTicket,
  options: { fetch?: typeof fetch; paceMs?: number } = {},
): Promise<void> {
  if (!isNotionSupportConfigured()) throw new Error("notion_not_configured");
  if (!/^[0-9a-f-]{36}$/i.test(ticket.id)) throw new Error("notion_invalid_ticket_id");
  const priority = PRIORITIES[ticket.priority];
  if (!priority) throw new Error("notion_invalid_priority");

  const key = process.env.NOTION_API_KEY!.trim();
  const source = process.env.NOTION_SUPPORT_DATA_SOURCE_ID!.trim();
  if (!/^[0-9a-f-]{36}$/i.test(source)) throw new Error("notion_invalid_data_source");
  const deadline = Date.now() + 25_000;
  const requestFetch = options.fetch ?? fetch;
  let requests = 0;

  async function request(path: string, body?: unknown): Promise<NotionResult> {
    if (requests++ > 0) await new Promise((resolve) => setTimeout(resolve, options.paceMs ?? 350));
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error("notion_deadline");
    try {
      const response = await requestFetch(`${API_ROOT}/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Notion-Version": API_VERSION,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(Math.min(5000, remaining)),
      });
      if (!response.ok) throw new Error(`notion_http_${response.status}`);
      return await response.json() as NotionResult;
    } catch (error) {
      // Provider responses and network errors can contain ticket content or
      // credentials. Only bounded status codes may leave this boundary.
      if (error instanceof Error && /^notion_http_\d{3}$/.test(error.message)) throw error;
      throw new Error("notion_request_failed");
    }
  }

  const found = await request(`data_sources/${source}/query`, {
    filter: { property: TICKET_ID_PROPERTY, rich_text: { equals: ticket.id } },
    page_size: 2,
  });
  if (!Array.isArray(found.results)) throw new Error("notion_invalid_response");
  if (found.results.length > 1) throw new Error("notion_duplicate_ticket_id");
  let pageId: string | undefined = found.results[0]?.id;

  if (!pageId) {
    const created = await request("pages", {
      parent: { type: "data_source_id", data_source_id: source },
      properties: {
        "Church Name": { title: richText(ticket.churchName || "FaithForm") },
        Priority: { select: { name: priority } },
        "Assigned Team Member": { multi_select: [{ name: "Emory" }] },
        "Build Status": { select: { name: "To Build" } },
        "Bugs / Fixes Requested": { rich_text: richText(ticket.subject) },
        [TICKET_ID_PROPERTY]: { rich_text: richText(ticket.id) },
      },
      children: [{
        object: "block", type: "paragraph",
        paragraph: { rich_text: [{
          type: "text", text: {
            content: "Open support ticket in FaithForm",
            link: { url: absoluteAppPath(`/admin/support/${ticket.id}`) },
          },
        }] },
      }],
    });
    pageId = created.id;
  }
  if (!pageId || !/^[0-9a-f-]{36}$/i.test(pageId)) throw new Error("notion_invalid_page_id");
  if (!ticket.body) return;

  // There is no Comments column in Fixes Requested. The message belongs in
  // actual page comments. Read them first to recover an uncertain prior write.
  const existing = new Map<string, number>();
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({ block_id: pageId, page_size: "100" });
    if (cursor) query.set("start_cursor", cursor);
    const comments = await request(`comments?${query}`);
    if (!Array.isArray(comments.results)) throw new Error("notion_invalid_response");
    for (const comment of comments.results) {
      const text = (comment.rich_text ?? []).map((part) => part.plain_text ?? part.text?.content ?? "").join("");
      existing.set(text, (existing.get(text) ?? 0) + 1);
    }
    if (comments.has_more && !comments.next_cursor) throw new Error("notion_invalid_response");
    cursor = comments.has_more ? comments.next_cursor! : null;
  } while (cursor);

  // Split unusually long messages across comments. Partial delivery resumes on
  // the next lease; no part is dropped when the invocation deadline is reached.
  for (const content of textParts(ticket.body, 16_000)) {
    const count = existing.get(content) ?? 0;
    if (count > 0) {
      existing.set(content, count - 1);
      continue;
    }
    const comment = await request("comments", {
      parent: { page_id: pageId }, rich_text: richText(content),
    });
    if (!comment.id) throw new Error("notion_invalid_response");
  }
}
