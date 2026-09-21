-- Group chat messages use the existing notification outbox.

alter table public.notification_outbox
  drop constraint if exists notification_outbox_kind_check;

alter table public.notification_outbox
  add constraint notification_outbox_kind_check
  check (kind in (
    'announcement_published', 'event_published', 'service_live', 'recording_published',
    'group_join_requested', 'group_request_approved', 'group_event_cancelled', 'group_message'
  ));

alter table public.notification_outbox
  drop constraint if exists notification_outbox_subject_type_check;

alter table public.notification_outbox
  add constraint notification_outbox_subject_type_check
  check (subject_type in (
    'announcement', 'stream_event', 'stream_recording', 'group_join_request', 'group_event', 'group_message'
  ));

notify pgrst, 'reload schema';
