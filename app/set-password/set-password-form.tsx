"use client";

import { useFormState, useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";

import { setOwnPassword, type SetPasswordState } from "./actions";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/temp-password";
import { cn } from "@/lib/utils";

const initialState: SetPasswordState = { ok: false };

const inputClass = cn(
  "min-h-11 w-full rounded-[10px] border-[1.5px] border-border bg-background px-4 py-3 text-[15px] text-foreground shadow-sm outline-none",
  "placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background",
);

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      disabled={pending}
      className="h-12 w-full px-5 text-base"
    >
      {pending ? "Saving…" : "Save password and continue"}
    </Button>
  );
}

export function SetPasswordForm({ email }: { email: string }) {
  const router = useRouter();
  const [state, formAction] = useFormState(
    async (prev: SetPasswordState, formData: FormData) => {
      const result = await setOwnPassword(prev, formData);
      if (result.ok) {
        router.replace("/dashboard");
        router.refresh();
      }
      return result;
    },
    initialState,
  );

  return (
    <div className="rounded-2xl border border-border bg-card p-8 shadow-card">
      <div className="mb-6 flex flex-col items-center text-center">
        <Logo size={64} priority className="mb-3" />
        <h1 className="font-heading text-[26px] font-bold text-foreground">
          Choose your password
        </h1>
        <p className="mt-2 text-base text-muted-foreground">
          You&apos;re signed in as <strong>{email}</strong>. Pick a password of
          your own — the temporary one stops working once you save.
        </p>
      </div>

      <form action={formAction} className="space-y-4">
        <div>
          <label
            htmlFor="password"
            className="mb-2 block text-sm font-semibold"
          >
            New password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            placeholder="••••••••"
            className={inputClass}
          />
          <p className="mt-1.5 text-xs text-muted-foreground">
            At least {MIN_PASSWORD_LENGTH} characters.
          </p>
        </div>

        <div>
          <label
            htmlFor="confirm_password"
            className="mb-2 block text-sm font-semibold"
          >
            Confirm password
          </label>
          <input
            id="confirm_password"
            name="confirm_password"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            placeholder="••••••••"
            className={inputClass}
          />
        </div>

        {state.error && (
          <p className="text-base text-destructive" role="alert">
            {state.error}
          </p>
        )}

        <SubmitButton />
      </form>
    </div>
  );
}
