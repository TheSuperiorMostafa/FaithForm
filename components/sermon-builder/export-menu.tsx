"use client";

import { Download, FileText, Presentation } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ExportMenu({ sermonId }: { sermonId: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="outline"
        size="sm"
        nativeButton={false}
        render={
          <a href={`/api/sermon/${sermonId}/export/pdf`} download>
            <FileText className="size-4" strokeWidth={1.75} />
            PDF
          </a>
        }
      />
      <Button
        variant="outline"
        size="sm"
        nativeButton={false}
        render={
          <a href={`/api/sermon/${sermonId}/export/pptx`} download>
            <Presentation className="size-4" strokeWidth={1.75} />
            PowerPoint
          </a>
        }
      />
      <Button variant="ghost" size="sm" disabled title="Coming soon">
        <Download className="size-4" strokeWidth={1.75} />
        More
      </Button>
    </div>
  );
}
