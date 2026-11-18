import { givingChurchDisplayName } from "@/lib/giving/branding";

type GivePageHeaderProps = {
  churchName: string;
  logoUrl?: string | null;
  titleAs?: "h1" | "h2";
};

export function GivePageHeader({
  churchName,
  logoUrl,
  titleAs = "h1",
}: GivePageHeaderProps) {
  const Title = titleAs;
  const displayName = givingChurchDisplayName(churchName);

  return (
    <div className="text-center">
      {logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt={displayName ? `${displayName} logo` : ""}
          className="mx-auto mb-4 h-12 w-auto max-w-[200px] object-contain"
        />
      )}
      <Title className="font-heading text-2xl font-bold">{displayName ?? "Online giving"}</Title>
    </div>
  );
}
