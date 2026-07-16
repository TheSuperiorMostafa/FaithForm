import type { OfficeHours, VoiceAssistantFormState } from "@/types/voice-assistant";

export type VoiceAssistantFieldErrors = Partial<
  Record<
    | "assistantName"
    | "denomination"
    | "churchPhone"
    | "greetingMessage"
    | "afterHoursMessage"
    | "officeHours",
    string
  >
>;

export type SetupChecklistItem = {
  id: string;
  label: string;
  done: boolean;
};

function digitCount(value: string): number {
  return value.replace(/\D/g, "").length;
}

function hasOpenOfficeDay(hours: OfficeHours): boolean {
  return Object.values(hours).some((day) => day.enabled);
}

/** Client-side validation aligned with AI phone setup best practices. */
export function validateVoiceAssistantForm(
  form: VoiceAssistantFormState,
): VoiceAssistantFieldErrors {
  const errors: VoiceAssistantFieldErrors = {};

  if (form.assistantName.trim().length < 2) {
    errors.assistantName = "Give your assistant a name (at least 2 characters).";
  }

  if (!form.denomination.trim()) {
    errors.denomination = "Select a denomination so answers match your church.";
  }

  if (digitCount(form.churchPhone) < 10) {
    errors.churchPhone =
      "Add a church phone number so callers can transfer to a real person.";
  }

  if (form.greetingMessage.trim().length < 20) {
    errors.greetingMessage =
      "Write a greeting callers hear first (at least a short sentence).";
  }

  if (!hasOpenOfficeDay(form.officeHours)) {
    errors.officeHours = "Enable at least one open office day.";
  }

  if (form.afterHoursEnabled && form.afterHoursMessage.trim().length < 10) {
    errors.afterHoursMessage =
      "Add an after-hours message, or turn after-hours mode off.";
  }

  return errors;
}

export function isVoiceAssistantFormValid(
  form: VoiceAssistantFormState,
): boolean {
  return Object.keys(validateVoiceAssistantForm(form)).length === 0;
}

export function getVoiceAssistantChecklist(
  form: VoiceAssistantFormState,
): SetupChecklistItem[] {
  return [
    {
      id: "name",
      label: "Name your assistant",
      done: form.assistantName.trim().length >= 2,
    },
    {
      id: "denomination",
      label: "Choose denomination",
      done: Boolean(form.denomination.trim()),
    },
    {
      id: "transfer",
      label: "Add church transfer number",
      done: digitCount(form.churchPhone) >= 10,
    },
    {
      id: "greeting",
      label: "Write a greeting",
      done: form.greetingMessage.trim().length >= 20,
    },
    {
      id: "hours",
      label: "Set office hours",
      done: hasOpenOfficeDay(form.officeHours),
    },
    {
      id: "afterHours",
      label: "After-hours message (if enabled)",
      done:
        !form.afterHoursEnabled ||
        form.afterHoursMessage.trim().length >= 10,
    },
  ];
}

/** Dial-in number is tracked separately (Retell phone provisioning). */
export function getDialInChecklistItem(hasPhoneNumber: boolean): SetupChecklistItem {
  return {
    id: "dialIn",
    label: "Get a dial-in phone number",
    done: hasPhoneNumber,
  };
}

export function formsAreEqual(
  a: VoiceAssistantFormState,
  b: VoiceAssistantFormState,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
