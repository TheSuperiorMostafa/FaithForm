/** The page around the setup card, shared by /setup and its loading state. */
export function SetupShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,var(--secondary),var(--background)_55%)] px-4 py-10 sm:p-8">
      <div className="w-full max-w-md">{children}</div>
    </main>
  );
}
