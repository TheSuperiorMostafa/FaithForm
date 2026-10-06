export function GET() {
  return Response.json({ applinks: { details: [{ appIDs: ["BPKHRJ24C7.io.faithform.app"], components: [{ "/": "/faithform/invite/*" }] }] } }, { headers: { "Cache-Control": "public, max-age=3600" } });
}
