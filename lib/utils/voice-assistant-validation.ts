import type {
  OfficeHours,
  VoiceAssistantFormState,
  VoiceProfileSummary,
} from "@/types/voice-assistant";

export type VoiceAssistantFieldErrors = Partial<
  Record<"assistantName" | "afterHoursMessage", string>
>;

export type SetupChecklistItem = {
  id: string;
  label: string;
  done: boolean;
};

function digitCount(value: string): number {
  return value.replace(/\D/g, "").length;
}

/** Client-side validation for voice delivery settings only. Profile fields validated on Church Profile. */
export function validateVoiceAssistantForm(
  form: VoiceAssistantFormState,
): VoiceAssistantFieldErrors {
  const errors: VoiceAssistantFieldErrors = {};

  if (form.assistantName.trim().length < 2) {
    errors.assistantName = "Give your assistant a name (at least 2 characters).";
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
  profile: VoiceProfileSummary,
): SetupChecklistItem[] {
  return [
    {
      id: "name",
      label: "Name your assistant",
      done: form.assistantName.trim().length >= 2,
    },
    {
      id: "denomination",
      label: "Set denomination in Church Profile",
      done: Boolean(profile.denomination.trim()),
    },
    {
      id: "transfer",
      label: "Add church phone in Church Profile",
      done: digitCount(profile.churchPhone) >= 10,
    },
    {
      id: "greeting",
      label: "Write a phone greeting in Church Profile",
      done: profile.greetingMessage.trim().length >= 20,
    },
    {
      id: "hours",
      label: "Set office hours in Church Profile",
      done: profile.hasOpenOfficeDay,
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

export function hasOpenOfficeDay(hours: OfficeHours): boolean {
  return Object.values(hours).some((day) => day.enabled);
}
