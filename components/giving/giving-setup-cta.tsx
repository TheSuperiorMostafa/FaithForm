import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function GivingSetupCta() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Set up online giving</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm text-muted-foreground">
        <p>
          Connect your church&apos;s Stripe account to accept one-time and recurring
          gifts. FaithForm charges no platform fee.
        </p>
        <Link
          href="/dashboard/settings?tab=giving"
          className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          Set up giving
        </Link>
      </CardContent>
    </Card>
  );
}
