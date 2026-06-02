import { Badge } from "@/components/ui/badge";

export function ModelBadge({ model }: { model?: string | null }) {
  if (!model) return null;
  return (
    <Badge variant="secondary" className="font-mono text-[10px]">
      {model}
    </Badge>
  );
}
