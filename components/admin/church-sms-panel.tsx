"use client";

import { useFormState, useFormStatus } from "react-dom";

import {
  disconnectChurchSms,
  saveChurchSms,
  type ChurchSmsFormState,
} from "@/app/admin/sms-actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/ui/phone-input";
import type { ChurchSmsStatus } from "@/lib/sms/church-sender";
import { formatUsPhoneDisplay } from "@/lib/sms/phone";

function SaveButton({ connected }: { connected: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : connected ? "Save" : "Connect texting phone"}
    </Button>
  );
}

function DisconnectButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" disabled={pending}>
      {pending ? "Disconnecting…" : "Disconnect"}
    </Button>
  );
}

/**
 * The phone a church's follow-up texts leave from.
 *
 * Texts used to go out through one server-wide key, so every church's members
 * heard from one pastor's phone. Each church now connects its own: install
 * SMSMobileAPI on the church's phone and paste that app's key here.
 */
export function ChurchSmsPanel({
  churchId,
  churchName,
  status,
}: {
  churchId: string;
  churchName: string;
  status: ChurchSmsStatus;
}) {
  const [saveState, saveAction] = useFormState<ChurchSmsFormState, FormData>(
    saveChurchSms,
    { ok: false },
  );
  const [disconnectState, disconnectAction] = useFormState<ChurchSmsFormState, FormData>(
    disconnectChurchSms,
    { ok: false },
  );

  const usingServerPhone = status.source === "server";
  const hasOwnPhone = status.source === "church";
  const feedback = saveState.error || disconnectState.error
    ? { tone: "error" as const, text: saveState.error ?? disconnectState.error }
    : saveState.message || disconnectState.message
      ? { tone: "ok" as const, text: saveState.message ?? disconnectState.message }
      : null;

  return (
    <Card className="md:col-span-2">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Texting phone</CardTitle>
          <span
            className={
              status.connected
                ? "rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-800 dark:bg-green-500/15 dark:text-green-300"
                : "rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground"
            }
          >
            {status.connected ? "Connected" : "Not connected"}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Attendance follow-up texts to {churchName}&apos;s members go out from
          this church&apos;s own phone. Install SMSMobileAPI on the church&apos;s
          phone and paste the key from that app. Until a phone is connected,
          follow-ups are saved but nothing is sent.
        </p>
        {status.connected && (
          <p className="mt-2 text-sm text-foreground">
            Texts go out from{" "}
            <strong className="font-semibold">
              {formatUsPhoneDisplay(status.fromNumber) ?? "a number that isn't recorded"}
            </strong>
            {usingServerPhone
              ? " — the server-wide phone (SMS_ENV_CHURCH_ID). Connect this church's own phone below to replace it."
              : "."}
          </p>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form action={saveAction} className="flex flex-col gap-4">
          <input type="hidden" name="church_id" value={churchId} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label htmlFor="sms_api_key">SMSMobileAPI key</Label>
              <Input
                id="sms_api_key"
                name="sms_api_key"
                type="password"
                autoComplete="off"
                placeholder={hasOwnPhone ? "Saved — leave blank to keep it" : "Paste the key from the app"}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="sms_from_number">The phone&apos;s number</Label>
              <PhoneInput
                id="sms_from_number"
                name="sms_from_number"
                defaultValue={hasOwnPhone ? (status.fromNumber ?? "") : ""}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <SaveButton connected={hasOwnPhone} />
          </div>
        </form>

        {hasOwnPhone && (
          <form action={disconnectAction}>
            <input type="hidden" name="church_id" value={churchId} />
            <DisconnectButton />
          </form>
        )}

        {feedback && (
          <p
            className={
              feedback.tone === "error"
                ? "text-sm text-destructive"
                : "text-sm text-green-700 dark:text-green-300"
            }
            role={feedback.tone === "error" ? "alert" : "status"}
          >
            {feedback.text}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
