# n8n workflows

## Attendance follow-up SMS

Import [`attendance-follow-up.json`](./attendance-follow-up.json) into your n8n instance.

### Setup

1. Activate the workflow and copy the **Production Webhook URL**.
2. Set `N8N_ATTENDANCE_WEBHOOK_URL` in FaithForm (Vercel / `.env.local`) to that URL.
3. Set `N8N_WEBHOOK_SECRET` to the same value in FaithForm and in the workflow (Webhook node → Header Auth or validate `x-faithform-secret` in a Function node).
4. Configure SMS credentials in n8n environment variables:
   - `SMS_MOBILE_API_URL`
   - `SMS_MOBILE_API_KEY`

### Payload (from FaithForm)

After attendance submit, FaithForm POSTs:

```json
{
  "churchId": "uuid",
  "serviceDate": "2026-05-25",
  "recordId": "uuid",
  "totalPresent": 57,
  "totalAbsent": 3,
  "followUpMemberIds": ["uuid"],
  "followUpMembers": [
    {
      "entryId": "uuid",
      "id": "uuid",
      "firstName": "Andrew",
      "lastName": "Archer",
      "phone": "+15551234567"
    }
  ],
  "notes": null,
  "statusCallbackUrl": "https://faithform.io/api/webhooks/attendance-follow-up-status"
}
```

### Status callback

After sending (or skipping) each SMS, POST to `statusCallbackUrl` with header `x-faithform-secret`:

```json
{
  "updates": [
    { "entryId": "uuid", "status": "sent" },
    { "entryId": "uuid", "status": "skipped", "error": "No phone number on file" },
    { "entryId": "uuid", "status": "failed", "error": "Provider error message" }
  ]
}
```

Statuses: `sent` | `failed` | `skipped`.
