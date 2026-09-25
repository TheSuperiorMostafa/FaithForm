import { Building2, CheckCircle2, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type StepWelcomeProps = {
  churchName: string;
  onNext: () => void;
};

export function StepWelcome({ churchName, onNext }: StepWelcomeProps) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-foreground sm:text-3xl">
          Welcome to FaithForm, {churchName}!
        </h1>
        <p className="mt-2 text-muted-foreground">
          Let&apos;s get your church set up. It takes about 5 minutes, and
          you can skip anything and come back to it later.
        </p>
      </div>

      <ul className="space-y-4">
        <li className="flex items-start gap-3">
          <Building2 className="mt-0.5 size-5 shrink-0 text-accent" strokeWidth={1.75} />
          <span className="text-base text-foreground">Create your account and add your church&apos;s details</span>
        </li>
        <li className="flex items-start gap-3">
          <Link2 className="mt-0.5 size-5 shrink-0 text-accent" strokeWidth={1.75} />
          <span className="text-base text-foreground">Connect Google and Facebook if you use them (optional)</span>
        </li>
        <li className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-accent" strokeWidth={1.75} />
          <span className="text-base text-foreground">Then you&apos;re ready to go</span>
        </li>
      </ul>

      <Button type="button" size="lg" className="h-12 w-full" onClick={onNext}>
        Get started
      </Button>
    </div>
  );
}
