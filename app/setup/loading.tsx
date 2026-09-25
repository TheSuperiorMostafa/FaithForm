import { SetupSkeleton } from "@/components/setup/setup-flow";
import { SetupShell } from "@/components/setup/setup-shell";

/** Shown while /setup checks whether this visitor already has a church. */
export default function SetupLoading() {
  return (
    <SetupShell>
      <SetupSkeleton />
    </SetupShell>
  );
}
