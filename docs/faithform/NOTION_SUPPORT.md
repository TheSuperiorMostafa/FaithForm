# Support tickets in Notion

Help and Admin ticket creation enqueue delivery in the same database transaction
as the saved ticket. A post-response task attempts delivery; an authenticated
five-minute cron retries pending jobs. Notion outages do not change the result
shown to the person submitting the ticket.

## Destination and fields

- Database: [Fixes Requested](https://www.notion.so/0fbaa7bcaa0c830a957381fb83b2462c).
- Data source: `499aa7bc-aa0c-82c8-8137-07de0244279e`.
- Church Name: church name, or FaithForm for a ticket with no linked church.
- Priority: the ticket's Low, Normal, High, or Urgent value.
- Assigned Team Member: Emory.
- Build Status: To Build.
- Bugs / Fixes Requested: ticket subject.
- Page comments: original ticket body, split across comments for long messages.
- FaithForm Ticket ID: stable ticket ID used to recover an uncertain delivery.

The destination has no Comments column; the body is posted through Notion's page
comments API. No submitter email, private admin notes, or subsequent conversation
replies are exported. Existing Notion pages retain the team's edits to assignment,
priority, and build status when delivery is retried.

## Enable automatic delivery

1. Apply `supabase/migrations/0140_support_notion_outbox.sql` through the approved
   migration process to the deliberately selected environment. This creates a
   service-only queue and enqueues existing tickets without altering their content.
2. Configure server-only `NOTION_API_KEY` and `NOTION_SUPPORT_DATA_SOURCE_ID` in
   that environment. The integration must have access to Fixes Requested, read
   and insert content, and read and insert comments. Keep the key in the secret
   store; `.env.example` intentionally contains no key.
3. Ensure the data source has the rich-text property `FaithForm Ticket ID`.
   This property was added to the destination during integration setup.
4. Deploy the application and its updated Vercel cron configuration. Set
   `CRON_SECRET` and the correct `NEXT_PUBLIC_SITE_URL` for ticket links.
5. Verify an authorized request to `GET /api/support/notion/retry` and inspect
   `support_notion_outbox` using a service/admin connection. Successful jobs have
   `delivered_at`; failures have a future `available_at` and retry automatically.

Queue entries are private, use exclusive two-minute leases, and retain only
delivery bookkeeping and a safe error code. A failed completion is recovered by
finding the ticket's existing Notion page and comments before writing again.
Provider messages and ticket contents are never included in delivery logs.
Disable forwarding by removing the Notion configuration; queued work is retained.
Do not run multiple independent backfills outside the lease mechanism.

## Validation

Focused tests live in `tests/unit/support-notion.test.ts`,
`tests/unit/support-notion-delivery.test.ts`, and
`tests/database/support-notion-outbox.test.ts`. Database tests require a disposable
Postgres target using the project's database test safeguards. Unit tests mock
providers and do not contact Notion or a hosted database.

The initial eight existing tickets were copied and their field mappings and body
comments verified against the source on October 21, 2026. Production activation uses the migration and deployment steps above.
