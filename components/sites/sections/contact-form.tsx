"use client";

import { useState, type FormEvent } from "react";

import type { VisitCtaContent } from "@/types/site";

type FormConfig = VisitCtaContent["form"];

type Status =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent" }
  | { kind: "error"; message: string };

const GENERIC_ERROR =
  "Something went wrong sending that. Please try again, or call the church office.";

/**
 * The Visit contact form.
 *
 * It knows nothing about the church it belongs to -- `config.endpoint` arrives
 * as resolved content and is treated as an opaque URL. The server resolves the
 * recipient from the tenant, so the destination address is never in the page.
 */
export function ContactForm({ config }: { config: FormConfig }) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (status.kind === "sending") return;

    const form = event.currentTarget;
    const data = new FormData(form);

    setStatus({ kind: "sending" });

    try {
      const response = await fetch(config.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: String(data.get("name") ?? ""),
          email: String(data.get("email") ?? ""),
          phone: String(data.get("phone") ?? ""),
          message: String(data.get("message") ?? ""),
          // Honeypot. Named plausibly so a form-filling bot takes the bait.
          website: String(data.get("website") ?? ""),
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setStatus({
          kind: "error",
          message:
            typeof body?.error === "string" && body.error.length < 200
              ? body.error
              : GENERIC_ERROR,
        });
        return;
      }

      form.reset();
      setStatus({ kind: "sent" });
    } catch {
      setStatus({ kind: "error", message: GENERIC_ERROR });
    }
  }

  if (status.kind === "sent") {
    return (
      <div className="site-form">
        <p className="site-form-status site-form-status-ok" role="status">
          {config.successMessage}
        </p>
      </div>
    );
  }

  return (
    <form className="site-form" onSubmit={onSubmit} noValidate={false}>
      <div className="site-form-heading">{config.heading}</div>
      {config.description ? (
        <p className="site-form-desc">{config.description}</p>
      ) : null}

      <div className="site-hp" aria-hidden="true">
        <label htmlFor="site-contact-website">Website</label>
        <input
          id="site-contact-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
        />
      </div>

      <div className="site-field">
        <label className="site-label" htmlFor="site-contact-name">
          Your name
        </label>
        <input
          id="site-contact-name"
          name="name"
          type="text"
          required
          maxLength={120}
          autoComplete="name"
          className="site-input"
        />
      </div>

      <div className="site-field">
        <label className="site-label" htmlFor="site-contact-email">
          Email
        </label>
        <input
          id="site-contact-email"
          name="email"
          type="email"
          required
          maxLength={200}
          autoComplete="email"
          className="site-input"
        />
      </div>

      {config.showPhone ? (
        <div className="site-field">
          <label className="site-label" htmlFor="site-contact-phone">
            Phone <span style={{ textTransform: "none" }}>(optional)</span>
          </label>
          <input
            id="site-contact-phone"
            name="phone"
            type="tel"
            maxLength={40}
            autoComplete="tel"
            className="site-input"
          />
        </div>
      ) : null}

      {config.showMessage ? (
        <div className="site-field">
          <label className="site-label" htmlFor="site-contact-message">
            Anything we should know?
          </label>
          <textarea
            id="site-contact-message"
            name="message"
            maxLength={2000}
            rows={4}
            className="site-textarea"
          />
        </div>
      ) : null}

      <button
        type="submit"
        className="site-btn site-btn-solid"
        disabled={status.kind === "sending"}
      >
        {status.kind === "sending" ? "Sending…" : config.submitLabel}
      </button>

      {config.consentNote ? (
        <p className="site-form-note">{config.consentNote}</p>
      ) : null}

      {status.kind === "error" ? (
        <p className="site-form-status site-form-status-error" role="alert">
          {status.message}
        </p>
      ) : null}
    </form>
  );
}
