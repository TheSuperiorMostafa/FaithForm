import type { Metadata } from "next";
import Link from "next/link";

import { LegalDocument } from "@/components/legal/legal-document";
import { LEGAL_PATHS, SUPPORT_EMAIL } from "@/lib/legal/policy-versions";

/*
 * LEGAL REVIEW PENDING — this text has not been reviewed by counsel.
 *
 * Google Play requires a web page, reachable without the app and without
 * signing in, that explains how to delete an account and what is deleted or
 * kept. Apple's guideline 5.1.1(v) requires the deletion itself to be offered
 * in the app. This page is the first; the Account screen in each app is the
 * second.
 *
 * What this page promises, and what the code does today — keep them in step:
 *
 *   - The in-app request (POST /api/mobile/v1/account/requests, kind
 *     "deletion") records the request and immediately stops the account
 *     working: lib/faithform/account-lifecycle.ts `requestAccountAction` sets
 *     status `deletion_requested`, and `requireActiveAccount` refuses it.
 *   - The deletion itself is `processDeletion` in the same file. When this
 *     page was written it had no caller — no route, cron or script runs it —
 *     and it anonymises the profile but does not remove the Supabase Auth user
 *     (email and password). Until both are wired up, requests must be completed
 *     by hand within the 30 days promised below.
 *   - Retained by design (same file's header): a church's `members` row, the
 *     attendance that references it, and financial history belong to the
 *     church.
 *   - The 30-day backup window assumes the Supabase plan's backup retention;
 *     confirm it.
 */

export const metadata: Metadata = {
  title: "Delete your account | FaithForm",
  description:
    "How to delete your FaithForm account, what is deleted, what churches and payment processors keep, and how long it takes.",
};

export default function AccountDeletionPage() {
  return (
    <LegalDocument
      title="Delete your FaithForm account"
      summary="You can delete your FaithForm account at any time, in the app or by email. Here's how, what gets deleted, what your church keeps, and how long it takes."
    >
      <h2 id="in-the-app">Delete your account in the app</h2>
      <ol>
        <li>Open the FaithForm app and sign in.</li>
        <li>Go to <strong>Account</strong>.</li>
        <li>Tap <strong>Delete my account</strong>, and confirm.</li>
      </ol>
      <p>
        Your account stops working right away, and you&apos;ll be signed out.
      </p>

      <h2 id="by-email">Delete your account by email</h2>
      <p>
        If you can&apos;t use the app &mdash; for example, if you no longer have
        your phone &mdash; email{" "}
        <a href={`mailto:${SUPPORT_EMAIL}?subject=Delete%20my%20account`}>
          {SUPPORT_EMAIL}
        </a>{" "}
        from the email address you use to sign in to FaithForm, with the subject
        &ldquo;Delete my account.&rdquo;
      </p>
      <p>
        We use that address to confirm the request is really from you. We&apos;ll
        never ask for your password. If you can no longer send email from that
        address, tell us and we&apos;ll help you confirm it another way.
      </p>

      <h2 id="deleted">What gets deleted</h2>
      <ul>
        <li>Your sign-in details: your email address and password.</li>
        <li>Your profile: your name, your preferences, and the church selected in the app.</li>
        <li>Your church connections: the churches you follow or joined, requests to join, and invitations. Churches will no longer see you as a follower or member in FaithForm.</li>
        <li>The link between your account and any church&apos;s own record of you.</li>
        <li>Your notification settings and your devices&apos; notification tokens.</li>
        <li>Your automatic check-in setting.</li>
      </ul>
      <p>
        FaithForm never stores your location history or photos, so there are
        none to delete.
      </p>

      <h2 id="kept">What is kept, and why</h2>
      <ul>
        <li>
          <strong>Your church&apos;s own records.</strong> If a church added you to
          its member directory or recorded your attendance, those records belong
          to the church. Deleting your FaithForm account doesn&apos;t delete them;
          contact the church if you&apos;d like them changed or removed.
        </li>
        <li>
          <strong>Records of your gifts.</strong> A gift is a financial record of
          the church that received it. Churches need to keep those records &mdash;
          for example, to provide giving statements and to meet tax and accounting
          rules &mdash; and Stripe, which processed the payment, keeps payment
          records as the law requires. Your past gifts remain in the
          church&apos;s records and at Stripe, but they&apos;re no longer connected
          to a FaithForm account, and you won&apos;t be able to see them in the
          app.
        </li>
        <li>
          <strong>What we must keep.</strong> A record that you asked us to delete
          your account, and limited information we need to prevent fraud or
          abuse &mdash; such as a church&apos;s decision to block an account
          &mdash; or to comply with the law.
        </li>
      </ul>

      <h2 id="timeline">How long it takes</h2>
      <p>
        Your account stops working as soon as you delete it in the app, or as
        soon as we confirm an emailed request. We finish deleting your
        information within 30 days. Copies in our encrypted backups are removed
        as those backups expire, within a further 30 days.
      </p>
      <p>
        Deletion can&apos;t be undone. You&apos;re welcome to create a new account
        later, but it won&apos;t include anything from the account you deleted.
      </p>

      <h2 id="church-staff">If you use FaithForm to run a church</h2>
      <p>
        This page is about personal FaithForm accounts. To remove a staff
        account or a church&apos;s information from FaithForm, email{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>

      <h2 id="more">More about your information</h2>
      <p>
        Our <Link href={LEGAL_PATHS.privacy}>Privacy Policy</Link> explains what
        FaithForm collects and your other choices, including asking for a copy
        of your information. Questions? Email{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>
    </LegalDocument>
  );
}
