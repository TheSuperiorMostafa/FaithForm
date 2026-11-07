-- Strict per-kind validation for notification_outbox
-- Addresses security review: prevent mismatched kind/topic/subject_type combinations

alter table public.notification_outbox
  drop constraint if exists notification_outbox_target_shape_check;

alter table public.notification_outbox
  add constraint notification_outbox_target_shape_check
  check (
    -- Explicit per-kind invariants
    (kind = 'announcement_published' and topic = 'announcements' and subject_type = 'announcement' and target_account_ids is null) or
    (kind = 'event_published' and topic = 'announcements' and subject_type = 'announcement' and target_account_ids is null) or
    (kind = 'service_live' and topic = 'streaming' and subject_type = 'stream_event' and target_account_ids is null) or
    (kind = 'recording_published' and topic = 'streaming' and subject_type = 'stream_recording' and target_account_ids is null) or
    (kind = 'group_join_requested' and topic = 'groups' and subject_type = 'group_join_request' and target_account_ids is null) or
    (kind = 'group_request_approved' and topic = 'groups' and subject_type = 'group_join_request' and target_account_ids is null) or
    (kind = 'group_event_cancelled' and topic = 'groups' and subject_type = 'group_event' and target_account_ids is null) or
    (kind = 'group_message' and topic = 'groups' and subject_type = 'group_message' and target_account_ids is null) or
    (kind = 'household_code_ready' and topic = 'checkin' and subject_type = 'household' and target_account_ids is not null and cardinality(target_account_ids) between 1 and 200) or
    (kind = 'checkin_guardian_alert' and topic = 'checkin' and subject_type = 'checkin_session' and target_account_ids is not null and cardinality(target_account_ids) between 1 and 200) or
    (kind = 'group_announcement' and topic = 'groups' and subject_type = 'group' and target_account_ids is not null and cardinality(target_account_ids) between 1 and 200)
  );

notify pgrst, 'reload schema';
