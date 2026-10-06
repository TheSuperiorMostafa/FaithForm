/** Play App Signing certificate fingerprints are public, deployment-specific identifiers. */
export function GET() {
  const fingerprints = (process.env.ANDROID_APP_LINKS_SHA256_CERT_FINGERPRINTS ?? "")
    .split(",").map(value => value.trim()).filter(value => /^(?:[A-Fa-f0-9]{2}:){31}[A-Fa-f0-9]{2}$/.test(value));
  return Response.json(fingerprints.length ? [{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: "io.faithform.app", sha256_cert_fingerprints: fingerprints } }] : [], { headers: { "Cache-Control": "public, max-age=3600" } });
}
