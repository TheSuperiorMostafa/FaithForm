"use client";

import { useState, type FormEvent } from "react";
import { ArrowUpRight, Check } from "lucide-react";

import { contactEmailHref, marketingConfig } from "./config";

type FormStatus = "idle" | "sending" | "sent" | "error";

export function MarketingContactForm() {
  const [status, setStatus] = useState<FormStatus>("idle");
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setStatus("sending");
    setError("");

    try {
      const response = await fetch("/api/marketing/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: String(data.get("name") ?? ""),
          email: String(data.get("email") ?? ""),
          church: String(data.get("church") ?? ""),
          message: String(data.get("message") ?? ""),
          website: String(data.get("website") ?? ""),
        }),
      });
      const result: { ok?: boolean; error?: string } = await response.json();
      if (!response.ok || !result.ok) {
        throw new Error(result.error || "We couldn't send your message right now.");
      }
      form.reset();
      setStatus("sent");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "We couldn't send your message right now.");
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <div className="marketing-contact-success" role="status">
        <span className="marketing-contact-success-icon"><Check size={28} aria-hidden="true" /></span>
        <h3>Your message is on its way.</h3>
        <p>Thanks for reaching out. We&apos;ll reply to the email address you gave us.</p>
      </div>
    );
  }

  return (
    <form className="marketing-contact-form" onSubmit={handleSubmit}>
      <div className="marketing-contact-fields">
        <label htmlFor="marketing-contact-name">Your name<input id="marketing-contact-name" name="name" autoComplete="name" maxLength={120} required /></label>
        <label htmlFor="marketing-contact-email">Email address<input id="marketing-contact-email" name="email" type="email" autoComplete="email" maxLength={200} required /></label>
      </div>
      <label htmlFor="marketing-contact-church">Church name<input id="marketing-contact-church" name="church" autoComplete="organization" maxLength={120} required /></label>
      <label htmlFor="marketing-contact-message">What would you like help with?<textarea id="marketing-contact-message" name="message" rows={5} minLength={10} maxLength={3000} required /></label>
      <div className="marketing-contact-trap" aria-hidden="true"><label htmlFor="marketing-contact-website">Website</label><input id="marketing-contact-website" name="website" tabIndex={-1} autoComplete="off" /></div>
      {status === "error" && <p className="marketing-contact-error" role="alert">{error} <a href={contactEmailHref}>Email {marketingConfig.contactEmail}</a>.</p>}
      <button className="marketing-button marketing-button-navy" type="submit" disabled={status === "sending"}>{status === "sending" ? "Sending…" : "Send message"} <ArrowUpRight size={18} aria-hidden="true" /></button>
    </form>
  );
}
