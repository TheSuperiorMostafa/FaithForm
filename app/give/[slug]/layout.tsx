import type { Metadata } from "next";
import { getChurchBySlug } from "@/lib/queries/giving";
import { givingBrandingStyle, givingChurchDisplayName, isValidHexColor } from "@/lib/giving/branding";
import { readableColorText } from "@/lib/branding/color-contrast";
import "./give-branding.css";

type LayoutProps = {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: LayoutProps): Promise<Metadata> {
  const { slug } = await params;
  const church = await getChurchBySlug(slug);
  const churchName = givingChurchDisplayName(church?.churchName);
  return {
    title: churchName ? `Give to ${churchName}` : "Online giving",
    description: churchName
      ? `Secure online giving to ${churchName}`
      : "Secure online giving",
    icons: { icon: church?.logoUrl ? [church.logoUrl] : [] },
  };
}

export default async function GiveLayout({ children, params }: LayoutProps) {
  const { slug } = await params;
  const church = await getChurchBySlug(slug);
  const primary = church?.givingPrimaryColor;
  const style = {
    ...givingBrandingStyle(primary, church?.givingAccentColor),
    "--give-primary-foreground": isValidHexColor(primary)
      ? readableColorText(primary)
      : "var(--primary-foreground)",
  } as React.CSSProperties;

  return (
    <div
      data-give-branded=""
      className="min-h-screen bg-background text-foreground"
      style={style}
    >
      <header className="give-shell-header border-b border-border px-4 py-4">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {church?.logoUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={church.logoUrl}
                alt=""
                className="h-8 w-auto max-w-[120px] object-contain"
              />
            )}
            <span className="font-heading text-lg font-bold tracking-tight">
              {givingChurchDisplayName(church?.churchName) ?? "Giving"}
            </span>
          </div>
          <span className="shrink-0 text-xs">Secure giving</span>
        </div>
      </header>
      <main className="mx-auto max-w-lg px-4 py-8">{children}</main>
    </div>
  );
}
