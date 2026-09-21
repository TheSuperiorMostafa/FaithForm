import type { Metadata } from "next";
import Link from "next/link";

import { LegalDocument } from "@/components/legal/legal-document";
import {
  LEGAL_PATHS,
  SUPPORT_EMAIL,
  TERMS_VERSION,
  formatPolicyDate,
} from "@/lib/legal/policy-versions";

/*
 * LEGAL REVIEW PENDING — this text has not been reviewed by counsel.
 *
 * Written to describe the product accurately, not yet as a lawyer's document.
 * Before relying on it, counsel should at least:
 *
 *   - name FaithForm's legal entity and address,
 *   - settle governing law, venue and any dispute-resolution clause (the
 *     current wording deliberately commits to no particular state),
 *   - set the liability cap amount,
 *   - confirm the Apple minimum end-user terms in "App stores" are complete for
 *     a custom EULA, or decide to rely on Apple's standard EULA instead,
 *   - confirm the giving section against the agreement churches sign.
 *
 * A change to what a person agrees to is a new TERMS_VERSION in
 * lib/legal/policy-versions.ts, which also makes both apps ask every person to
 * accept it.
 *
 * Deliberately absent: any statement that a gift is tax-deductible. FaithForm
 * records no deductibility, jurisdiction or exemption, and says so everywhere
 * (see "a receipt makes no tax claim" in tests/security/giving-privacy.test.ts).
 */

export const metadata: Metadata = {
  title: "Terms of Service | FaithForm",
  description: "The terms for using the FaithForm apps and website.",
};

export default function TermsOfServicePage() {
  return (
    <LegalDocument
      title="Terms of Service"
      effectiveDate={formatPolicyDate(TERMS_VERSION)}
      summary="These terms are the agreement between you and FaithForm for using the FaithForm apps for iPhone and Android and FaithForm's website. Please read them. By creating an account or using FaithForm, you agree to them."
    >
      <h2 id="agreement">1. The agreement</h2>
      <p>
        These terms apply to the FaithForm apps (&ldquo;the apps&rdquo;) and
        FaithForm&apos;s public web pages, together &ldquo;FaithForm.&rdquo;
        &ldquo;We&rdquo; and &ldquo;us&rdquo; mean the company that operates
        FaithForm. Our <Link href={LEGAL_PATHS.privacy}>Privacy Policy</Link>{" "}
        explains how we handle your information and is part of these terms.
      </p>
      <p>
        If you use FaithForm to run a church, the agreement between your church
        and FaithForm also applies to that use, and wins if the two conflict.
      </p>

      <h2 id="eligibility">2. Your account</h2>
      <ul>
        <li>You must be at least 13 years old, or older where the law of your country requires, to create an account.</li>
        <li>Give accurate information, and keep your account to yourself. You&apos;re responsible for what happens under your account, so keep your password safe and tell us at <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a> if you think someone else has used it.</li>
        <li>You can delete your account at any time. See <Link href={LEGAL_PATHS.accountDeletion}>how to delete your account</Link>.</li>
      </ul>

      <h2 id="churches">3. Churches on FaithForm</h2>
      <p>
        FaithForm is a platform that churches use to share news, services and
        sermons, take attendance, and receive gifts. Each church is an
        independent organization. Churches are not operated by FaithForm, and
        FaithForm is not responsible for a church&apos;s teaching, content,
        events, or decisions.
      </p>
      <p>
        Each church decides who can join it, what it publishes and to whom, how
        it records attendance, and whether to remove or block an account from
        its community. Questions about those decisions are for the church.
      </p>

      <h2 id="content">4. Church content</h2>
      <p>
        Announcements, sermons, video, and other material a church publishes
        belong to that church or to whoever licensed it to the church. You may
        view it in FaithForm for your own personal, non-commercial use. Please
        don&apos;t copy, redistribute, or rebroadcast it without the owner&apos;s
        permission.
      </p>

      <h2 id="giving">5. Giving</h2>
      <ul>
        <li>
          <strong>Your gift goes to the church.</strong> When you give through
          FaithForm, you are giving to the church you chose, not to FaithForm.
          The church receives the gift and is responsible for how it is used and
          for any receipts or giving statements it provides.
        </li>
        <li>
          <strong>Payments are processed by Stripe.</strong> Gifts are
          processed by Stripe on the church&apos;s own Stripe account. If you pay
          with Apple Pay or Google Pay, their terms also apply. A payment can be
          declined by your bank, by Stripe, or by the limits a church sets.
        </li>
        <li>
          <strong>Refunds.</strong> Gifts are generally final. If you think a
          gift was made in error, contact the church that received it; the
          church decides whether to refund it. FaithForm can&apos;t reverse a
          gift on its own.
        </li>
        <li>
          <strong>Fees.</strong> Payment processing fees are paid by the church,
          unless the church offers you the option to add an amount to cover them
          and you choose to.
        </li>
        <li>
          <strong>Taxes.</strong> FaithForm doesn&apos;t give tax advice and
          doesn&apos;t confirm how any gift is treated for tax purposes. Ask the
          church or a tax adviser.
        </li>
        <li>
          <strong>Recurring gifts.</strong> The apps take one-time gifts.
          Recurring gifts, where a church offers them, are managed through that
          church&apos;s own giving page.
        </li>
      </ul>

      <h2 id="check-in">6. Check-in and location features</h2>
      <p>
        Check-in by code and automatic check-in are optional, and automatic
        check-in only runs if you turn it on. Location readings are not always
        accurate, so a check-in may occasionally not be counted; your church
        decides what counts as attendance. Don&apos;t share or reuse check-in
        codes to record attendance for someone who isn&apos;t there, and
        don&apos;t falsify your device&apos;s location.
      </p>

      <h2 id="acceptable-use">7. Using FaithForm responsibly</h2>
      <p>When you use FaithForm, don&apos;t:</p>
      <ul>
        <li>break the law, or use FaithForm to harass, threaten, or harm anyone;</li>
        <li>pretend to be someone else, or misrepresent your connection to a church;</li>
        <li>use giving for fraud, to test stolen payment details, or to move money for anyone other than yourself;</li>
        <li>try to get into accounts, church information, or parts of FaithForm you aren&apos;t permitted to access;</li>
        <li>interfere with FaithForm&apos;s operation, overload it, or get around its security or limits;</li>
        <li>copy, scrape, or reverse engineer FaithForm, except where the law allows it despite this restriction.</li>
      </ul>

      <h3>What you post, and what we don&apos;t allow</h3>
      <p>
        Where a church turns on groups and messages, you can post messages,
        photos, videos, and files, and set a profile photo. What you post is
        yours, and you are responsible for it. You keep your rights in it, and
        you give FaithForm permission to store and show it to the people it was
        meant for, so the feature can work.
      </p>
      <p>
        <strong>
          There is no tolerance for objectionable content or abusive behaviour.
        </strong>{" "}
        Don&apos;t post anything that is:
      </p>
      <ul>
        <li>harassing, bullying, threatening, or intended to intimidate someone;</li>
        <li>hateful towards a person or group, including on the basis of race, ethnicity, national origin, religion, disability, age, sex, gender identity, or sexual orientation;</li>
        <li>sexually explicit, or sexual content involving a minor of any kind;</li>
        <li>violent, gratuitously graphic, or encouraging self-harm, suicide, or an eating disorder;</li>
        <li>unlawful, fraudulent, deceptive, or promoting illegal activity;</li>
        <li>spam, a scam, or a solicitation unrelated to the church community you posted it in;</li>
        <li>private information about someone else that you don&apos;t have permission to share;</li>
        <li>someone else&apos;s work, when you don&apos;t have the right to post it.</li>
      </ul>
      <p>
        Every message and every person in a conversation can be reported from
        inside the app, and you can block someone so they can no longer message
        you. Reports go to the moderators of the church the content is in, and
        to us. We and the church review reports of objectionable content and act
        on them &mdash; removing the content, and removing the person who posted
        it &mdash; within 24 hours of the report. We may remove content, suspend
        an account, or close it, and a church may remove content or remove
        someone from its own community.
      </p>
      <p>
        To report something, use the report option on the message or the person
        in the app, or write to us at{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>

      <h2 id="feedback">8. Feedback</h2>
      <p>
        If you send us ideas or suggestions, we may use them to improve
        FaithForm without owing you anything for them.
      </p>

      <h2 id="termination">9. Suspension and ending your use</h2>
      <p>
        You can stop using FaithForm and delete your account at any time. We may
        suspend or close an account that breaks these terms, puts other people
        or churches at risk, or where the law requires us to. A church may
        separately remove or block an account from its own community.
      </p>

      <h2 id="app-stores">10. App stores</h2>
      <p>
        If you downloaded an app from the Apple App Store or Google Play, the
        store&apos;s own terms also apply to your use of that store. For the
        iPhone app, you and FaithForm also acknowledge that:
      </p>
      <ul>
        <li>these terms are between you and FaithForm only, not Apple, and FaithForm &mdash; not Apple &mdash; is responsible for the app and its content;</li>
        <li>Apple has no obligation to provide maintenance or support for the app;</li>
        <li>if the app fails to meet any applicable warranty, you may notify Apple, and Apple will refund the purchase price, if any; to the extent the law allows, Apple has no other warranty obligation for the app;</li>
        <li>Apple is not responsible for addressing any claims relating to the app, including product liability claims, claims that the app fails to meet legal or regulatory requirements, and consumer protection or privacy claims;</li>
        <li>if anyone claims the app or your use of it infringes their intellectual property, FaithForm, not Apple, is responsible for dealing with that claim;</li>
        <li>you confirm you are not located in a country subject to a U.S. government embargo or designated as a &ldquo;terrorist supporting&rdquo; country, and are not on any U.S. government list of prohibited or restricted parties;</li>
        <li>Apple and its subsidiaries are third-party beneficiaries of these terms and may enforce them against you.</li>
      </ul>

      <h2 id="disclaimers">11. Disclaimers</h2>
      <p>
        We work hard to keep FaithForm running well, but it is provided &ldquo;as
        is&rdquo; and &ldquo;as available.&rdquo; To the extent the law allows,
        we make no warranties beyond those stated in these terms, including any
        implied warranties of merchantability, fitness for a particular purpose,
        and non-infringement, and we don&apos;t promise that FaithForm will
        always be available or free of errors. Some places don&apos;t allow these
        disclaimers, so they may not all apply to you.
      </p>

      <h2 id="liability">12. Limitation of liability</h2>
      <p>
        To the extent the law allows, FaithForm won&apos;t be liable for indirect,
        incidental, special, consequential, or punitive damages, or for lost
        data or profits, arising from your use of FaithForm, and our total
        liability for any claim about FaithForm is limited to the greater of the
        amount you paid FaithForm itself in the 12 months before the claim or
        US$100. Gifts you make to a church are payments to that church, not to
        FaithForm. Nothing in these terms limits liability that can&apos;t be
        limited by law.
      </p>

      <h2 id="law">13. Governing law</h2>
      <p>
        These terms are governed by the laws of the United States and of the
        state in which FaithForm is organized, without regard to conflict-of-law
        rules. If you live somewhere whose laws give you protections that
        can&apos;t be waived by agreement, those protections still apply.
      </p>

      <h2 id="changes">14. Changes to these terms</h2>
      <p>
        When we update these terms, we&apos;ll change the effective date at the
        top of this page. If a change is significant, the apps will ask you to
        review and accept the updated terms before you continue. If you
        don&apos;t agree to them, you can stop using FaithForm and delete your
        account.
      </p>

      <h2 id="contact">15. Contact us</h2>
      <p>
        Questions about these terms? Email{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>
    </LegalDocument>
  );
}
