import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="flex items-center justify-between border-b border-border px-4 py-4 md:px-8">
        <Link href="/" className="flex items-center gap-2">
          <Logo size={36} priority />
          <span className="font-heading text-lg font-semibold text-foreground">
            FaithForm
          </span>
        </Link>
        <p className="text-sm text-muted-foreground">
          Need help?{" "}
          <a
            href="mailto:support@faithform.app"
            className="text-foreground underline-offset-4 hover:underline"
          >
            support@faithform.app
          </a>
        </p>
      </header>
      <main className="flex flex-1 flex-col items-center px-4 py-8 md:py-12">
        {children}
      </main>
    </div>
  );
}
