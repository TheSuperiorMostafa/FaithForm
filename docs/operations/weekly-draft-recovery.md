# Recover an uncertain weekly email draft

FaithForm reserves one church and local Monday before asking Gmail or iCloud
Mail to save a draft. If the provider times out, the draft may still exist.
FaithForm leaves that church/week in `uncertain` (or `creating` if the process
stopped before it could record the failure) and will not retry automatically.
Other churches and the next week are unaffected.

1. Identify the church and `week_start` from the scheduled-job error. Read
   `public.announcement_weekly_draft_claims` and record its `claim_id`, state,
   and `updated_at`. A `saved` state needs no recovery. Allow an active
   `creating` attempt to finish.
2. With the church owner's authorization, inspect the connected Gmail or
   iCloud Mail Drafts folder for that week's FaithForm message. Do not send it
   or delete another draft. Compare the church, week, subject, and contents.
3. If the provider draft exists and its provider draft ID is available, call
   `complete_weekly_announcement_draft(church_id, week_start, claim_id,
   draft_id)` with the service role. This marks the claim and the church's
   last-draft marker in one transaction. Verify both values match. If the ID
   cannot be recovered, leave the claim for manual handling and confirm the
   next week's run is unaffected.
4. If no provider draft exists, wait at least 15 minutes from the claim's last
   update, then call `clear_weekly_announcement_draft_claim(church_id,
   week_start, claim_id, true)` with the service role. The final argument
   records that the mailbox was checked. A `false` result means the claim
   changed or is too recent; re-read it before acting. Only then may an admin
   make this week's draft again from FaithForm.

The claim functions are executable by `service_role` only. Never reset a claim
on a timeout alone: the provider may have saved the draft before the reply
failed. Escalate repeated claim or completion failures to the database/on-call
owner. The scheduled-job response must be monitored for church-level errors.
