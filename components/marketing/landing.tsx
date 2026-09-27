import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight, BookOpen, Check, ClipboardCheck, Mail, Megaphone, Smartphone } from "lucide-react";
import { CurrentHero } from "./current-hero";
import { MarketingContactForm } from "./contact-form";
import { FutureVideoHero } from "./future-video-hero";
import { MarketingNav } from "./marketing-nav";
import { contactHref, marketingConfig } from "./config";

function Hero({ loading = false }: { loading?: boolean }) {
  const video = marketingConfig.walkthrough;
  if (!loading && video.enabled && video.src) {
    return <FutureVideoHero src={video.src} poster={video.poster} captions={video.captions} />;
  }
  return <CurrentHero loading={loading} />;
}

function ProductFlow() {
  return (
    <div className="marketing-flow" aria-label="A FaithForm announcement can appear in the app, weekly email, and on Facebook">
      <div className="marketing-flow-topline"><span className="marketing-flow-live" /> A real FaithForm workflow <span>01 / 03</span></div>
      <div className="marketing-flow-input">
        <div className="marketing-flow-icon">F</div>
        <div><span>ONE ACTION</span><strong>Write an announcement.</strong></div>
        <span className="marketing-flow-check"><Check size={17} aria-hidden="true" /></span>
      </div>
      <div className="marketing-flow-path" aria-hidden="true"><span /><span /><span /></div>
      <div className="marketing-flow-outputs">
        <div><span className="marketing-flow-output-index">01</span><span>In the app</span><Check size={17} aria-hidden="true" /></div>
        <div><span className="marketing-flow-output-index">02</span><span>In Monday&apos;s email</span><Check size={17} aria-hidden="true" /></div>
        <div><span className="marketing-flow-output-index">03</span><span>On Facebook</span><Check size={17} aria-hidden="true" /></div>
      </div>
      <div className="marketing-flow-footnote">Choose the channels that make sense for your church.</div>
    </div>
  );
}

export function MarketingLanding({ loading = false }: { loading?: boolean }) {
  return (
    <div className="marketing">
      <a className="marketing-skip" href="#marketing-main">Skip to content</a>
      <MarketingNav />
      <main id="marketing-main">
        <Hero loading={loading} />

        <section id="the-problem" className="marketing-problem" aria-labelledby="marketing-problem-title">
          <div className="marketing-container marketing-problem-inner">
            <span className="marketing-eyebrow">Sound familiar?</span>
            <h2 id="marketing-problem-title">Your week disappears<br /><em>one task at a time.</em></h2>
            <p>An announcement to send. Attendance to log. A sermon to prepare. The software meant to help keeps asking for another hour.</p>
            <div className="marketing-problem-crossout" aria-hidden="true"><span>copy</span><span>paste</span><span>repeat</span></div>
            <p className="marketing-problem-bridge">It adds up.</p>
          </div>
        </section>

        <section id="mission" className="marketing-mission" aria-labelledby="marketing-mission-title">
          <div className="marketing-container marketing-stats" aria-label="Pastoral workload statistics from FaithForm's mission statement">
            <span className="marketing-eyebrow">The weight behind a busy week</span>
            <div className="marketing-stat marketing-stat-one"><span className="marketing-stat-number">40<span>%</span></span><div><p>pastors risk of burnout</p><small>4x higher than in 2015</small></div></div>
            <div className="marketing-stat marketing-stat-two"><span className="marketing-stat-number">49<span>%</span></span><div><p>of pastors say they&apos;re overwhelmed by church admin</p></div></div>
            <div className="marketing-stat marketing-stat-three"><span className="marketing-stat-number">55–75</span><div><p>Hours worked by 9 in 10 pastors</p></div></div>
          </div>
          <div className="marketing-mission-band"><div className="marketing-container marketing-mission-top"><span className="marketing-eyebrow">Our mission</span><h2 id="marketing-mission-title">We Give Pastors<br /><em>Their Time Back.</em></h2><p>Every feature exists for one reason:<br /><strong>fewer hours on admin, more hours on ministry.</strong></p></div></div>
        </section>

        <section id="how-it-works" className="marketing-product" aria-labelledby="marketing-product-title">
          <div className="marketing-container">
            <div className="marketing-section-intro">
              <span className="marketing-eyebrow">Inside your web dashboard</span>
              <h2 id="marketing-product-title">One action.<br /><em>More off your list.</em></h2>
              <p>The dashboard gathers the weekly work in one place. Tell your church once, then let FaithForm help that update reach where it needs to go.</p>
            </div>
            <div className="marketing-product-grid">
              <div className="marketing-product-copy">
                <div className="marketing-product-line"><span>01</span><div><h3>Stop doing the same work three times.</h3><p>Write an announcement, then choose where it belongs: in the app, the weekly email, and your church&apos;s Facebook Page.</p></div></div>
                <div className="marketing-product-line"><span>02</span><div><h3>See the time coming back.</h3><p>The dashboard tracks hours saved by the work FaithForm takes off your team&apos;s plate.</p></div></div>
                <div className="marketing-product-line"><span>03</span><div><h3>Keep the people in view.</h3><p>Attendance, follow-up, sermons, and church updates sit where your team can find them.</p></div></div>
              </div>
              <ProductFlow />
            </div>
          </div>
        </section>

        <section id="pastor-tools" className="marketing-week" aria-labelledby="marketing-week-title">
          <div className="marketing-container">
            <span className="marketing-eyebrow">Built for the pastor&apos;s week</span>
            <h2 id="marketing-week-title">More ministry.<br /><em>Fewer loose ends.</em></h2>
            <div className="marketing-week-rows">
              <div className="marketing-week-row"><ClipboardCheck size={37} strokeWidth={1.3} aria-hidden="true" /><div><h3>Know who was there. Know who needs a call.</h3><p>Track attendance across services and keep follow-up connected to real people.</p></div><span className="marketing-week-route">Attendance + follow-up</span></div>
              <div className="marketing-week-row"><BookOpen size={37} strokeWidth={1.3} aria-hidden="true" /><div><h3>Give sermon prep a place of its own.</h3><p>Organize sermons and series, build your message, and prepare slides in the same workspace.</p></div><span className="marketing-week-route">Sermons</span></div>
              <div className="marketing-week-row"><Megaphone size={37} strokeWidth={1.3} aria-hidden="true" /><div><h3>Share the news without repeating yourself.</h3><p>Send church updates through the channels your team chooses from one announcement flow.</p></div><span className="marketing-week-route">Announcements</span></div>
            </div>
          </div>
        </section>

        <section id="the-app" className="marketing-member-app" aria-labelledby="marketing-app-title">
          <div className="marketing-container marketing-member-app-grid">
            <div className="marketing-member-app-copy">
              <span className="marketing-eyebrow">A little extra for your people</span>
              <h2 id="marketing-app-title">The dashboard is for you.<br /><em>The iPhone app is for them.</em></h2>
              <p>Your churchgoers can use FaithForm Connect to see updates, join groups, watch services, and check in. You run the week from the web dashboard; they stay connected from their phones.</p>
              <div className="marketing-member-app-actions"><a className="marketing-button marketing-button-gold" href={marketingConfig.appStore} target="_blank" rel="noopener noreferrer">FaithForm Connect on the App Store <ArrowUpRight size={18} aria-hidden="true" /></a><span>For iPhone · Android coming later</span></div>
            </div>
            <div className="marketing-member-app-art">
              <div className="marketing-member-phone" aria-hidden="true"><div className="marketing-member-phone-notch" /><Image src="/faithform-logo.png" width={84} height={84} alt="" /><strong>FaithForm<br />Connect</strong><span>For your churchgoers</span></div>
              <div className="marketing-member-qr"><Image src={marketingConfig.appStoreQr} width={116} height={116} alt="QR code to open FaithForm Connect on the App Store" /><span>SCAN WITH IPHONE</span></div>
            </div>
          </div>
        </section>

        <section className="marketing-team" aria-labelledby="marketing-team-title">
          <div className="marketing-container marketing-team-grid">
            <div><span className="marketing-eyebrow">Built around your church</span><h2 id="marketing-team-title">Not a platform.<br /><em>A team that builds for you.</em></h2></div>
            <div className="marketing-team-copy"><p>Every church runs differently, so we stopped making software you have to fit into.</p><p>We built FaithForm around what you tell us your church actually needs, then keep building as you grow.</p><p>We come in and work with you to install a personalized system that handles the admin hours you need done but that slowly steal the meaningful time each week.</p><a className="marketing-inline-arrow" href={contactHref}>Tell us about your church <ArrowUpRight size={19} aria-hidden="true" /></a></div>
          </div>
        </section>

        <section className="marketing-finale" aria-labelledby="marketing-finale-title">
          <div className="marketing-container marketing-finale-inner"><span className="marketing-eyebrow">The reason behind all of it</span><h2 id="marketing-finale-title">Churches don&apos;t grow because they work harder.<br /><em>They grow when the systems stop getting in the way.</em></h2><p>Nothing falls through the cracks, and the hours currently lost to disconnected tools go back to people and to preparation.</p><a className="marketing-button marketing-button-gold" href={contactHref}>Let&apos;s get your time back <ArrowUpRight size={19} aria-hidden="true" /></a></div>
        </section>

        <section id="contact" className="marketing-contact" aria-labelledby="marketing-contact-title">
          <div className="marketing-container marketing-contact-grid">
            <div className="marketing-contact-copy"><span className="marketing-eyebrow">Let&apos;s talk</span><h2 id="marketing-contact-title">Tell us about<br /><em>your church.</em></h2><p>Tell us what keeps taking time each week. We&apos;ll listen, then show you where FaithForm can help.</p><div className="marketing-contact-direct"><span>Prefer to reach us directly?</span><a href={`mailto:${marketingConfig.contactEmail}`}>{marketingConfig.contactEmail}</a><a href={`tel:${marketingConfig.contactPhone}`}>(270) 970-9414</a></div></div>
            <MarketingContactForm />
          </div>
        </section>
      </main>
      <footer className="marketing-footer"><div className="marketing-container marketing-footer-inner"><div className="marketing-footer-brand"><Image src="/faithform-logo.png" width={36} height={36} alt="" /><span>faithform<span>.</span></span></div><p>More time for what matters.</p><div className="marketing-footer-links"><Link href={marketingConfig.signIn}>Sign In</Link><a href={contactHref}><Mail size={15} aria-hidden="true" /> Contact</a><a href={`tel:${marketingConfig.contactPhone}`}><Smartphone size={15} aria-hidden="true" /> Call (270) 970-9414</a><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link></div><span className="marketing-copyright">© {new Date().getFullYear()} FaithForm</span></div></footer>
    </div>
  );
}
