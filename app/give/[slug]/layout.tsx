import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Give | FaithForm",
  description: "Secure online giving powered by FaithForm",
};

export default function GiveLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-primary px-4 py-4 text-primary-foreground">
        <div className="mx-auto flex max-w-lg items-center justify-between">
          <span className="font-heading text-lg font-bold tracking-tight">
            FaithForm
          </span>
          <span className="text-xs opacity-80">Secure giving</span>
        </div>
      </header>
      <main className="mx-auto max-w-lg px-4 py-8">{children}</main>
    </div>
  );
}
