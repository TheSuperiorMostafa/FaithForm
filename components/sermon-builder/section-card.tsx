"use client";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type SectionCardProps = {
  title: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  rows?: number;
};

export function SectionCard({
  title,
  value,
  onChange,
  onBlur,
  rows = 6,
}: SectionCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          rows={rows}
          className="leading-relaxed"
        />
      </CardContent>
    </Card>
  );
}

export function SectionCardActions({
  onRegenerate,
  loading,
}: {
  onRegenerate?: () => void;
  loading?: boolean;
}) {
  if (!onRegenerate) return null;
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onRegenerate}
      disabled={loading}
    >
      {loading ? "Regenerating…" : "Regenerate"}
    </Button>
  );
}
