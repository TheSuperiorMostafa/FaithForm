import { STRIPE_NONPROFIT_RATE_LABEL } from "@/lib/stripe/config";

type GivePageHeaderProps = {
  churchName: string;
  logoUrl?: string | null;
  showRateNote?: boolean;
  titleAs?: "h1" | "h2";
};

export function GivePageHeader({
  churchName,
  logoUrl,
  showRateNote = true,
  titleAs = "h1",
}: GivePageHeaderProps) {
  const Title = titleAs;

  return (
    <div className="text-center">
      {logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt={`${churchName} logo`}
          className="mx-auto mb-4 h-12 w-auto max-w-[200px] object-contain"
        />
      )}
      <Title className="font-heading text-2xl font-bold">{churchName}</Title>
      {showRateNote && (
        <p className="mt-1 text-sm text-muted-foreground">
          Give securely. Processing: {STRIPE_NONPROFIT_RATE_LABEL}. No FaithForm fee.
        </p>
      )}
    </div>
  );
}
