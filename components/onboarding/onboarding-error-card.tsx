import { Card, CardContent } from "@/components/ui/card";

export function OnboardingErrorCard({
  title,
  message,
}: {
  title: string;
  message: string;
}) {
  return (
    <Card className="w-full max-w-md rounded-[20px] shadow-card">
      <CardContent className="p-10 text-center">
        <h1 className="font-heading text-2xl font-semibold text-foreground">
          {title}
        </h1>
        <p className="mt-3 text-muted-foreground">{message}</p>
      </CardContent>
    </Card>
  );
}
