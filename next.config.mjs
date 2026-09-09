/** @type {import('next').NextConfig} */

const BASE_SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig = {
  experimental: {
    serverActions: {
      // Next defaults this to 1MB, which is smaller than any photo a phone
      // takes. Every upload in the app runs through a Server Action, so
      // without this a church picking a banner photo gets a raw 413 from the
      // framework before our own size check, and our own friendly message,
      // ever run.
      //
      // 4MB rather than the 12MB the upload field offers: Vercel refuses a
      // serverless request body over 4.5MB whatever Next is configured to
      // accept, so anything higher here would only move the failure. Photos
      // above this are shrunk in the browser before they are sent, in
      // lib/sites/downscale-image.ts.
      bodySizeLimit: "4mb",
    },
  },

  async headers() {
    return [
      // The embed player is meant to be iframed into a church's own website,
      // so it must not carry X-Frame-Options and must allow any frame ancestor.
      // It only plays back video, so capture permissions stay denied here.
      {
        source: "/live/:slug/embed",
        headers: [
          ...BASE_SECURITY_HEADERS,
          { key: "Content-Security-Policy", value: "frame-ancestors *" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      // Church websites are framed by the dashboard's own preview pane, so they
      // must permit same-origin framing. Deliberately `self` and not `*`: the
      // preview always runs at faithform.io/sites/<slug>, and letting a church
      // site be framed by an arbitrary origin invites clickjacking on the
      // giving and contact-form controls it carries.
      {
        source: "/sites/:path*",
        headers: [
          ...BASE_SECURITY_HEADERS,
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      // Everything except the embed player and church sites. `camera`/`microphone`
      // must be allowlisted for `self` or getUserMedia/getDisplayMedia in the
      // browser broadcast studio fails with NotAllowedError before any prompt.
      {
        source: "/((?!live/[^/]+/embed|sites/).*)",
        headers: [
          ...BASE_SECURITY_HEADERS,
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(self), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
