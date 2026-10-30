import type { ReactNode } from "react";
import { Card, CardContent } from "@/components/ui/card";

export function TextAppCheckContent({ children }: { children?: ReactNode }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-5 p-6">
        <h2 className="font-heading text-xl font-bold">Open your SMS Mobile API app to make sure all texts send through properly</h2>
        {children ?? <span aria-hidden className="flex h-12 items-center justify-center rounded-xl bg-primary px-6 font-semibold text-primary-foreground">Hold to confirm</span>}
      </CardContent>
    </Card>
  );
}
