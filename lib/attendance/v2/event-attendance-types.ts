export type EventAttendanceSettings = {
  enabled: boolean;
  occurrenceId: string | null;
  campusId: string | null;
  automaticEnabled: boolean;
  codeEnabled: boolean;
  kioskEnabled: boolean;
  checkinOpensMinutesBefore: number;
  checkinClosesMinutesAfter: number;
  locked: boolean;
};

export const DEFAULT_EVENT_ATTENDANCE: EventAttendanceSettings = {
  enabled: false,
  occurrenceId: null,
  campusId: null,
  automaticEnabled: false,
  codeEnabled: false,
  kioskEnabled: false,
  checkinOpensMinutesBefore: 30,
  checkinClosesMinutesAfter: 30,
  locked: false,
};
