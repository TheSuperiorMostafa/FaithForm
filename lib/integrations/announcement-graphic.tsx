import { ImageResponse } from "next/og";

export type AnnouncementGraphicInput = {
  churchName: string;
  title: string;
  when: string;
  location: string;
};

export async function generateAnnouncementGraphic(
  input: AnnouncementGraphicInput,
): Promise<ArrayBuffer> {
  const locationLine = input.location.trim() || "See announcement for details";

  const response = new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "100%",
          height: "100%",
          background: "linear-gradient(135deg, #1e3a5f 0%, #2d5a87 50%, #c9a227 100%)",
          padding: "56px 64px",
          color: "#ffffff",
          fontFamily: "system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div
            style={{
              fontSize: 28,
              fontWeight: 600,
              opacity: 0.9,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
            }}
          >
            {input.churchName}
          </div>
          <div
            style={{
              fontSize: 64,
              fontWeight: 700,
              lineHeight: 1.1,
              maxWidth: "100%",
            }}
          >
            {input.title}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ fontSize: 32, fontWeight: 500 }}>{input.when}</div>
          <div style={{ fontSize: 28, opacity: 0.92 }}>{locationLine}</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );

  return response.arrayBuffer();
}
