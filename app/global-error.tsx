"use client";

import { useEffect } from "react";

/** Last resort when even the root layout fails. Plain words, one way forward. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          background: "#F8F7F4",
          color: "#002D5F",
          display: "grid",
          placeItems: "center",
          minHeight: "100vh",
          margin: 0,
          padding: 24,
          textAlign: "center",
        }}
      >
        <div style={{ maxWidth: 440 }}>
          <h1 style={{ fontSize: 28, marginBottom: 12 }}>Something went wrong</h1>
          <p style={{ fontSize: 17, lineHeight: 1.5, marginBottom: 24 }}>
            Nothing you saved was lost. Try again, and if it keeps happening,
            contact FaithForm support.
          </p>
          <button
            onClick={reset}
            style={{
              minHeight: 48,
              padding: "0 24px",
              borderRadius: 12,
              border: 0,
              background: "#C5A059",
              color: "#002D5F",
              fontSize: 16,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
