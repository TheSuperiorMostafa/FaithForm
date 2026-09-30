"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { contactHref, marketingConfig } from "./config";

export function MarketingNav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="marketing-nav-wrap">
      <nav className="marketing-nav" aria-label="Main navigation">
        <Link className="marketing-logo" href="/" aria-label="FaithForm home" onClick={() => setOpen(false)}>
          <Image src="/faithform-logo.png" width={34} height={34} alt="" priority />
          <span>faithform</span>
        </Link>
        <div className="marketing-nav-links">
          <a href="#how-it-works">The Dashboard</a>
          <a href="#mission">Our Mission</a>
          <a href="#the-app">Your Church App</a>
        </div>
        <div className="marketing-nav-actions">
          <Link className="marketing-sign-in" href={marketingConfig.signIn}>Sign In</Link>
          <a className="marketing-nav-cta" href={contactHref}>Let&apos;s talk <ArrowUpRight size={16} aria-hidden="true" /></a>
        </div>
        <button className="marketing-menu-toggle" type="button" aria-expanded={open} aria-controls="marketing-mobile-menu" aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen(!open)}>
          {open ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
        </button>
      </nav>
      <div id="marketing-mobile-menu" className={`marketing-mobile-menu ${open ? "is-open" : ""}`} inert={!open}>
        <a href="#how-it-works" onClick={() => setOpen(false)}>The Dashboard</a>
        <a href="#mission" onClick={() => setOpen(false)}>Our Mission</a>
        <a href="#the-app" onClick={() => setOpen(false)}>Your Church App</a>
        <Link href={marketingConfig.signIn} onClick={() => setOpen(false)}>Sign In</Link>
        <a className="marketing-mobile-cta" href={contactHref} onClick={() => setOpen(false)}>Let&apos;s talk <ArrowUpRight size={18} aria-hidden="true" /></a>
      </div>
    </header>
  );
}
