import type { Metadata } from "next";
import { getChurchBySlug } from "@/lib/queries/giving";
import { givingBrandingStyle, hasChurchBranding } from "@/lib/giving/branding";
import "./give-branding.css";

type LayoutProps = {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({ params }: LayoutProps): Promise<Metadata> {
  const { slug } = await params;
  const church = await getChurchBySlug(slug);
  return {
    title: church ? `Give to ${church.churchName}` : "Give | FaithForm",
    description: church
      ? `Secure online giving to ${church.churchName}`
      : "Secure online giving powered by FaithForm",
  };
}

export default async function GiveLayout({ children, params }: LayoutProps) {
  const { slug } = await params;
  const church = await getChurchBySlug(slug);
  const branded = church
    ? hasChurchBranding(
        church.logoUrl,
        church.givingPrimaryColor,
        church.givingAccentColor,
      )
    : false;

  const style = church
    ? givingBrandingStyle(church.givingPrimaryColor, church.givingAccentColor)
    : undefined;

  return (
    <div
      data-give-branded=""
      className="min-h-screen bg-background text-foreground"
      style={style as React.CSSProperties}
    >
      <header
        className={
          branded
            ? "give-shell-header border-b border-white/10 px-4 py-4"
            : "border-b border-border bg-primary px-4 py-4 text-primary-foreground"
        }
      >
        <div className="mx-auto flex max-w-lg items-center justify-between">
          {branded && church ? (
            <div className="flex items-center gap-3">
              {church.logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={church.logoUrl}
                  alt=""
                  className="h-8 w-auto max-w-[120px] object-contain"
                />
              )}
              <span className="font-heading text-lg font-bold tracking-tight">
                {church.churchName}
              </span>
            </div>
          ) : (
            <span className="font-heading text-lg font-bold tracking-tight">
              FaithForm
            </span>
          )}
          <span className={branded ? "text-xs opacity-90" : "text-xs opacity-80"}>
            Secure giving
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-lg px-4 py-8">{children}</main>
    </div>
  );
}
