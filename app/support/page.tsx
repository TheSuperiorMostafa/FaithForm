import type { Metadata } from "next";
import Link from "next/link";

import { LegalDocument } from "@/components/legal/legal-document";
import { LEGAL_PATHS, SUPPORT_EMAIL } from "@/lib/legal/policy-versions";

/*
 * The Support URL both stores list, and the page a reviewer opens first.
 *
 * App Store Connect and Google Play each require a support page that a person
 * who has never signed in can read. It is deliberately public — see
 * lib/auth/route-access.ts, where everything outside /dashboard, /admin and
 * /onboarding is — and deliberately short: someone reading it has a problem
 * they want a person for, so the address to write to is the first thing on it.
 *
 * Keep the answers here true to the apps. Each one is what the code does
 * today, and the account section is the same flow /account-deletion documents.
 */

export const metadata: Metadata = {
  title: "Support | FaithForm",
  description:
    "How to get help with the FaithForm app: contact us, report a problem or objectionable content, and manage or delete your account.",
};

export default function SupportPage() {
  return (
    <LegalDocument
      title="Support"
      summary="Write to us and a person will answer. Most questions about a church's own information are quickest to answer by that church, and the rest are ours."
    >
      <h2 id="contact">Contact us</h2>
      <p>
        Email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. We answer
        within two business days. It helps to tell us the church you are
        connected with, the phone or device you are using, and what you saw.
      </p>

      <h2 id="report">Report objectionable content or someone&apos;s behaviour</h2>
      <p>
        In the app, open the message or the person you want to report, choose{" "}
        <strong>Report or block</strong>, and pick a reason. You can block
        someone at the same time, and they will no longer be able to message
        you. Reports reach the moderators of that church and us.
      </p>
      <p>
        We review reports of objectionable content and act on them within 24
        hours, by removing the content and the person who posted it. You can
        also report something directly to us at{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. What is not
        allowed is listed in our{" "}
        <Link href={LEGAL_PATHS.terms}>Terms of Service</Link>.
      </p>

      <h2 id="account">Your account</h2>
      <ul>
        <li>
          <strong>Signing in.</strong> The app signs you in with your email
          address and password. Use &ldquo;Forgot password&rdquo; on the sign-in
          screen to set a new one.
        </li>
        <li>
          <strong>Joining a church.</strong> Find a church in the app by name,
          city, or postal code, or by letting the app look for churches near
          you. A church may need to approve your request to join.
        </li>
        <li>
          <strong>Deleting your account.</strong> Open Account, then
          &ldquo;Delete my account.&rdquo; What is deleted, what your church
          keeps, and how long it takes are on{" "}
          <Link href={LEGAL_PATHS.accountDeletion}>this page</Link>.
        </li>
      </ul>

      <h2 id="giving">Giving</h2>
      <p>
        Gifts go to the church, through that church&apos;s own account with
        Stripe, our payment processor. For a receipt, a refund, or a question
        about where a gift went, ask the church you gave to &mdash; they hold
        the record and can issue a refund. If you think a gift was made from
        your account without your permission, write to us.
      </p>

      <h2 id="checkin">Check-in and location</h2>
      <p>
        You can check in by scanning the code your church shows, or by typing
        it. Automatic check-in is optional: it is off until you turn it on, and
        you can turn it off in the app at any time. If it is not noticing your
        arrival, check that FaithForm has location access set to
        &ldquo;Always&rdquo; and that Precise Location is on. Your church
        decides what counts as attendance.
      </p>

      <h2 id="privacy">Privacy and your data</h2>
      <p>
        What we collect and who sees it is in our{" "}
        <Link href={LEGAL_PATHS.privacy}>Privacy Policy</Link>. To ask for a
        copy of your information, or to correct something, write to{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>

      <h2 id="churches">For churches</h2>
      <p>
        If you run a church on FaithForm and need help with the dashboard,
        giving payouts, or your church&apos;s page, write to{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> from the address
        your church account uses.
      </p>
    </LegalDocument>
  );
}
