# FaithForm email updates

This release implements the concrete requests in the November 6 Updates email.
It is integrated onto main's existing fixes rather than replacing them with the
older audit checkout.

| Area | Result |
| --- | --- |
| Attendance | Remove mode/guest helper copy; hide past-service cancellation and check-in controls. |
| Groups | Every active member can save availability; staff/leaders can read it. Group announcements post through authorized Messaging with retry-safe message IDs. |
| People | People grants allow basic add/edit; six editable membership statuses and filters; sensitive operations stay admin-only. |
| Kids Check-In | Guardian-code loading has bounded timeout/recovery; transient alert authority errors retry; existing guardian authorization and revocation checks remain. |
| Giving | Low-ink contribution statements, contact/EIN/period/gift type/fund totals; manual cash/check/other gifts; Excel/CSV preview and idempotent import; gross/net; top actions and More. |
| Events | Events naming, Event Description, structured addresses, bounded daily/weekly/monthly calendar repeats in church time, and multiple email recipients. |
| Email documents | Full subject/body DOCX attachment and a native private Google Doc after draft claim ownership. Google needs Drive permission; external mailbox edits do not update the document. |
| Settings | Formatted phone input. |
| Live | Recording MP4 upload with private storage, server verification and review before publication; compact connection status. |
| Website | Large preview, narrow adjustment panel and full-screen editor, preserving main's sizing/security fixes. |

## Validation

- TypeScript passes; generated contracts, design tokens and localization match.
- 2,179 web/security/policy tests pass with the existing local-port relay test excluded after its sandbox bind failure.
- All 606 Swift package tests pass, including the five pickup-code tests.
- Focused lint passes; whole-project lint has existing warnings and no errors.
- PDF short, long and many-fund layouts were rendered and inspected.
- Database tests cover offline amounts, tenant/role restrictions, atomic rollback,
  concurrent idempotency and execute grants. Runtime execution needs a disposable
  PostgreSQL target; local initdb is denied shared-memory access.
- Native app/device builds and Safari runtime validation remain limited by
  sandbox/tool restrictions. These package tests do not establish device delivery.

## Rollout

Apply migrations 0142_people_membership_status.sql, 0144_offline_giving.sql and
0145_group_member_availability.sql before deploying the corresponding UI/API.
The selected FaithForm production database was inspected read-only: these three
features were absent. No production migrations or test donations were executed.
Follow the migration rehearsal and deployment instructions before application.

Reconnect the church's Google account with Drive access to enable native Docs;
ensure Drive API is enabled for the configured Google project. Existing
connections retain the portable document attachment and show a reconnect notice.
No Google permission consent or provider messages were sent during this work.

Verify real devices with two verified guardians sharing a household, guardian
revocation and checkout before dispatch, and a staff Alert. Verify a real private
recording upload and narrow/short Safari editor windows before calling rollout
fully validated. The email's unannotated "adjustments to website" screenshot did
not define another independently testable visual change.
