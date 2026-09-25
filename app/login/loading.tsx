import { LoginSkeleton } from "./login-form";
import { LoginShell } from "./login-shell";

/** Shown while /login checks whether someone is already signed in. */
export default function LoginLoading() {
  return (
    <LoginShell>
      <LoginSkeleton />
    </LoginShell>
  );
}
