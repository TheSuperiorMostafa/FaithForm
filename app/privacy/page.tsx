import type { Metadata } from "next";
import Link from "next/link";

import { LegalDocument } from "@/components/legal/legal-document";
import {
  LEGAL_PATHS,
  PRIVACY_VERSION,
  SUPPORT_EMAIL,
  formatPolicyDate,
} from "@/lib/legal/policy-versions";

/*
 * LEGAL REVIEW PENDING — this text has not been reviewed by counsel.
 *
 * It was written from what the code actually does as of this version, so it is
 * accurate about the product, but it is not yet a lawyer's document. Before
 * relying on it, counsel should at least:
 *
 *   - add FaithForm's legal entity name and postal address (both stores and
 *     GDPR/CCPA expect one),
 *   - confirm the controller/processor framing for church-held data matches
 *     the agreement churches sign,
 *   - confirm the state-law and EEA/UK rights language and response times,
 *   - confirm the backup and log retention periods against the Supabase and
 *     Vercel plans in use.
 *
 * Every factual claim below is tied to code. If you change what the apps
 * collect, change this page — and if the change is material, bump
 * PRIVACY_VERSION in lib/legal/policy-versions.ts, which also makes both apps
 * ask every person to accept the new version.
 *
 *   Nearby search coordinates are used once and discarded: lib/faithform/nearby.ts
 *   Automatic check-in keeps a band, never coordinates: lib/mobile/v1/attendance-service.ts
 *   Nothing is sent outside a check-in window: on a region event both apps ask
 *     /attendance/{slug}/occurrence (which carries no location) and stop when it is null
 *     (AutomaticAttendance.swift / AutomaticAttendance.kt). Keep that true in the apps.
 *   The arrival record (attendance_detections) expires in 2 hours and is purged by the
 *     daily cleanup cron: migration 0074, lib/attendance/v2/jobs.ts
 *   Turning it off deletes pending arrivals: withdraw_automatic_attendance_evidence (0074),
 *     called from recordConsent in lib/faithform/account.ts
 *   The Android mock-location flag is the `mockLocationReported` attempt field
 *
 * The automatic check-in section was made more specific in September 2026 without
 * moving PRIVACY_VERSION: it describes the same collection (a location on arrival,
 * with the app closed, for check-in only), the same purpose and the same sharing the
 * 2026-08-01 text already disclosed. Moving the version would ask every person on
 * both apps to accept again for a clarification.
 *
 * PRIVACY_VERSION did move to 2026-09-20, for the store submission, and for the
 * opposite reason: the photos people upload (profile, group, chat attachments) and
 * the group messages Stream delivers and stores are collection the August text did
 * not disclose at all. New collection is a new version, and every person is asked
 * again. The sections to keep true to the code:
 *   Photos are chosen by the person (PhotosPicker / .fileImporter), never read from
 *     the library by the app: tests/security/checkin-privacy.test.ts
 *   Messages, attachments, reports and blocks: lib/messaging/safety.ts, stream-provider.ts
 *   The scanner decodes on-device and uploads no image: AVFoundationScanner.swift, CameraXScanner.kt
 *   No card data reaches FaithForm: tests/security/giving-privacy.test.ts
 *   No analytics, advertising or tracking SDKs in either app: Package.swift, libs.versions.toml
 */

export const metadata: Metadata = {
  title: "Privacy Policy | FaithForm",
  description:
    "What the FaithForm apps and website collect, how it is used and shared, and the choices you have.",
};

export default function PrivacyPolicyPage() {
  return (
    <LegalDocument
      title="Privacy Policy"
      effectiveDate={formatPolicyDate(PRIVACY_VERSION)}
      summary="FaithForm helps churches stay connected with the people who attend them. This policy explains what the FaithForm apps and website collect, why, who it is shared with, and the choices you have. We don't sell your information, we don't show you ads, and we don't track you across other companies' apps or websites."
    >
      <h2 id="scope">Who this policy covers</h2>
      <p>
        This policy covers the FaithForm apps for iPhone and Android (&ldquo;the
        apps&rdquo;) and FaithForm&apos;s public web pages, such as a
        church&apos;s online giving page. &ldquo;FaithForm,&rdquo; &ldquo;we&rdquo;
        and &ldquo;us&rdquo; mean the company that operates them.
      </p>
      <p>
        FaithForm is also used by churches to run their ministry. When a church
        uses FaithForm to keep its own records about the people in its
        community &mdash; its member directory, attendance, or giving records,
        for example &mdash; the church decides what it records and why, and
        FaithForm handles that information on the church&apos;s behalf. The
        church&apos;s own privacy practices apply to those records, and
        questions about them are best directed to the church. See{" "}
        <a href="#churches">Information your church holds</a>.
      </p>

      <h2 id="collect">Information we collect</h2>

      <h3>Your account</h3>
      <ul>
        <li>Your email address and password. Your password is stored in hashed form, so no one at FaithForm can read it.</li>
        <li>Your name, if you choose to give one.</li>
        <li>An account ID we assign to you.</li>
        <li>Which version of our Terms of Service and this Privacy Policy you accepted, and when.</li>
      </ul>

      <h3>Your churches</h3>
      <ul>
        <li>The churches you follow, ask to join, or join, invitations you accept, and when each of those changed.</li>
        <li>Which church you have selected in the app.</li>
        <li>If a church connects your account to its own record of you (for example, when you accept its invitation), the link between the two.</li>
      </ul>

      <h3>Location</h3>
      <p>The apps use your device&apos;s location for two features, and only when you allow it.</p>
      <ul>
        <li>
          <strong>Finding churches near you.</strong> When you ask the app to
          show nearby churches, it sends your device&apos;s current location to
          our servers once, to find churches within a set distance. That
          location is used for that one search and then discarded: we don&apos;t
          store it, log it, or connect it to your account. You can always search
          for a church by name instead.
        </li>
        <li>
          <strong>Automatic check-in.</strong> If your church offers automatic
          check-in and you turn it on, the app explains what it does and asks
          for your permission first, and then your device asks for location
          access, including access while the app is closed, so you can be
          checked in when you arrive. See{" "}
          <a href="#automatic-check-in">Automatic check-in</a> below for
          exactly what it uses, sends and keeps.
        </li>
      </ul>

      <h3 id="automatic-check-in">Automatic check-in</h3>
      <p>
        Automatic check-in is optional. It is off unless you turn it on, the app
        works fully without it, and you can still check in by scanning or typing
        your church&apos;s check-in code, or be marked present by church staff,
        wherever your church offers those.
      </p>
      <ul>
        <li>
          <strong>What your phone watches for.</strong> Only your arrival at the
          locations your church has set up for check-in, such as the circle
          around its building. Your phone&apos;s operating system does the
          watching; the app doesn&apos;t follow your movements or record where
          you go.
        </li>
        <li>
          <strong>When anything is sent.</strong> Only when you arrive during a
          service&apos;s check-in window, which your church sets around its
          service times. Arriving at any other time, or being anywhere else,
          sends no location to us.
        </li>
        <li>
          <strong>What is sent.</strong> When you arrive during a check-in
          window, the app sends your location at that moment, how accurate it
          is, the time, which service and which of your church&apos;s locations
          it is for, and, on Android, whether your phone reported the location
          as simulated. It can send this more than once during one arrival: a
          few minutes later to confirm you stayed, or again if a reading
          wasn&apos;t precise enough.
        </li>
        <li>
          <strong>What is kept.</strong> We use your location to work out
          whether you were at church and then discard it. We never store your
          coordinates. We keep the result: whether you were inside or near the
          check-in area, how accurate the reading was, how long you had been
          there, and whether you were checked in, as part of your church&apos;s
          attendance records. So that we can confirm you stayed, we also keep a
          short record that you arrived at that church location and when; it
          stops being usable after two hours and is
          deleted automatically within about a day.
        </li>
        <li>
          <strong>Who sees it.</strong> Your church sees that you attended a
          service and that you were checked in automatically. Your church never
          sees your location, and no one else does either.
        </li>
        <li>
          <strong>Turning it off.</strong> Turn automatic check-in off in the
          app at any time, or remove the app&apos;s location access in your
          device settings. When you turn it off in the app, it stops watching for
          your arrival and we delete any arrival that was still waiting to be
          confirmed. Check-ins that were already counted stay part of your
          church&apos;s attendance records.
        </li>
      </ul>

      <h3>Camera</h3>
      <p>
        The apps use your camera only to read a check-in code your church shows
        on screen. The code is read on your device and only its contents are
        sent to us. The apps never take or save a photo with your camera, and
        they never read your photo library on their own. You can type the
        check-in code instead of scanning it.
      </p>

      <h3>Photos you choose</h3>
      <p>
        You can upload a profile photo, and a group&apos;s leaders can upload a
        photo for their group. If your church turns on group messages, you can
        also attach photos, videos, and files to a message. In every case you
        pick the file yourself, and only the file you pick is uploaded. Your
        profile photo is shown to the churches you are connected with and to
        people in groups you belong to.
      </p>

      <h3>Group messages</h3>
      <ul>
        <li>
          Where a church turns them on, you can send messages in a group and
          directly to other members of that church. We store the messages you
          send, anything you attach to them, and who read them, so the
          conversation is there when you come back to it.
        </li>
        <li>
          Messages are delivered through <strong>Stream</strong>, a messaging
          provider that stores them for us. Your name, profile photo, and
          account identifier are shared with Stream so your messages can be
          shown with your name on them.
        </li>
        <li>
          If you report a message or a person, we keep your report, the reason
          you chose, anything you wrote, and the message you reported, and we
          make it available to that church&apos;s moderators and to us, so it
          can be acted on. If you block someone, we keep a record of that too.
        </li>
        <li>
          Your church can see the messages sent in its groups, and its
          moderators can remove content and remove people from a group.
        </li>
      </ul>

      <h3>Attendance and check-in</h3>
      <p>
        When you check in &mdash; by scanning a code, typing one, or
        automatically &mdash; we record the church, the service, the time, how
        you checked in, and whether the check-in was counted.
      </p>

      <h3>Giving</h3>
      <ul>
        <li>
          When you give, we record the church, the fund, the amount, the time,
          and the status of the payment, so we can show you your giving history
          and receipts.
        </li>
        <li>
          Gifts are paid to the church, through the church&apos;s own account
          with our payment processor, Stripe. Your card or bank details, or
          your Apple Pay or Google Pay payment, go directly to Stripe. FaithForm
          never receives or stores your full card number. Stripe tells us
          whether the payment succeeded and gives us reference numbers for it.
        </li>
        <li>
          If you give on a church&apos;s giving web page, we also collect the
          name and email address you enter, so a receipt can be sent to you.
        </li>
      </ul>

      <h3>Notifications and preferences</h3>
      <ul>
        <li>
          If you allow notifications, a notification token for your device,
          along with your device platform, app version, operating system
          version, and language, so we can deliver notifications to the right
          device.
        </li>
        <li>Your notification settings for each church (for example, announcements and events) and your communication preferences.</li>
      </ul>

      <h3>Technical information</h3>
      <p>
        When the apps or website connect to our servers, our hosting providers
        receive standard technical information such as your IP address, the
        type of device or browser, the app version, and the time of the
        request. We use it to run the service, keep it secure, prevent abuse,
        and fix problems.
      </p>
      <p>
        The apps contain no advertising or third-party analytics software, don&apos;t
        use your device&apos;s advertising identifier, and don&apos;t track you
        across other companies&apos; apps or websites.
      </p>

      <h2 id="use">How we use information</h2>
      <ul>
        <li>To provide the apps: your account, your church connections, church announcements, sermons and video, check-in, giving, receipts, and notifications.</li>
        <li>To let the churches you connect with do what you&apos;ve asked of them, such as approving a request to join, counting your attendance, or receiving your gift.</li>
        <li>To keep FaithForm and the people using it safe: securing accounts, preventing fraud and abuse, and limiting repeated requests.</li>
        <li>To contact you about your account, such as confirmation and password-reset emails, giving receipts, and replies to messages you send us.</li>
        <li>To comply with the law and enforce our <Link href={LEGAL_PATHS.terms}>Terms of Service</Link>.</li>
      </ul>
      <p>
        We don&apos;t sell your personal information, share it for advertising,
        or use it to build advertising profiles.
      </p>

      <h2 id="share">How information is shared</h2>

      <h3>With your churches</h3>
      <p>
        A church you follow or join can see your name as you entered it, whether
        you are following, have asked to join, or are a member, and when that
        changed. If a church has connected your account to its own record of
        you, your check-ins and gifts at that church become part of that
        church&apos;s records. A church receiving your gift can also see the
        payment details Stripe shows to the recipient of a payment, such as your
        card brand and the last four digits of your card. Churches never see your
        location or your password.
      </p>

      <h3>With service providers</h3>
      <p>We use a small number of companies to run FaithForm. They may use your information only to provide their services to us:</p>
      <ul>
        <li><strong>Supabase</strong> &mdash; database, sign-in, and file storage.</li>
        <li><strong>Vercel</strong> &mdash; hosting for our website and servers.</li>
        <li><strong>Stripe</strong> &mdash; payment processing for gifts. Stripe also uses payment information for its own purposes, such as preventing fraud, under the <a href="https://stripe.com/privacy" rel="noopener noreferrer">Stripe Privacy Policy</a>.</li>
        <li><strong>Stream</strong> &mdash; delivery and storage of group and direct messages, where a church turns messaging on.</li>
        <li><strong>Resend</strong> &mdash; delivery of emails such as giving receipts.</li>
        <li><strong>Apple and Google</strong> &mdash; delivery of notifications to your device through Apple Push Notification service and Firebase Cloud Messaging, if you allow notifications.</li>
      </ul>

      <h3>For legal reasons and business changes</h3>
      <p>
        We may share information when we believe the law requires it, to protect
        the safety, rights, or property of the people who use FaithForm, of
        churches, of FaithForm, or of the public, or as part of a merger,
        acquisition, or sale of our business, in which case this policy will
        continue to apply to your information.
      </p>

      <h2 id="churches">Information your church holds</h2>
      <p>
        Churches that use FaithForm may keep their own records about the people
        in their community &mdash; a member directory, household and
        children&apos;s check-in information entered by church staff, attendance,
        and giving records, for example. The church controls those records and
        decides how long to keep them. FaithForm stores and processes them on the
        church&apos;s behalf and doesn&apos;t use them for its own purposes. If you
        ask us about information a church holds, we&apos;ll refer you to that
        church or work with it to respond.
      </p>

      <h2 id="retention">How long we keep information</h2>
      <ul>
        <li>We keep your account information for as long as your account is open. When you delete your account, we delete it as described on our <Link href={LEGAL_PATHS.accountDeletion}>account deletion page</Link>.</li>
        <li>Location sent for a nearby search or an automatic check-in is not kept at all; only the check-in result described above is stored. The short record of an arrival waiting to be confirmed is deleted within about a day, or straight away if you turn automatic check-in off.</li>
        <li>Check-in and giving records are part of your church&apos;s records. They are kept for as long as the church needs them, including to meet its financial record-keeping obligations, and Stripe keeps payment records as the law requires.</li>
        <li>Technical logs are kept by our hosting providers for a limited period, and copies of deleted information can remain in encrypted backups until those backups expire.</li>
      </ul>

      <h2 id="choices">Your choices and rights</h2>
      <ul>
        <li><strong>Location.</strong> Automatic check-in and nearby search are both optional. Turn automatic check-in off in the app, or change location permission in your device settings; you can still check in with your church&apos;s code or be marked present by staff.</li>
        <li><strong>Camera.</strong> Deny camera access and type check-in codes instead.</li>
        <li><strong>Notifications.</strong> Change them in the app or turn them off in your device settings.</li>
        <li><strong>Your profile.</strong> Update your name and preferences in the app.</li>
        <li><strong>Deleting your account.</strong> Delete it in the app, or follow the steps on our <Link href={LEGAL_PATHS.accountDeletion}>account deletion page</Link>.</li>
      </ul>
      <p>
        Depending on where you live &mdash; for example, in the European Economic
        Area, the United Kingdom, or certain U.S. states such as California &mdash;
        you may have the right to access, correct, delete, or receive a copy of
        your personal information, to object to or restrict some uses of it, and
        not to be treated differently for exercising these rights. To make a
        request, email <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>{" "}
        from the email address on your account, so we can confirm the request is
        yours. We&apos;ll respond within the time the law requires. If you&apos;re
        in the EEA or UK, you can also complain to your local data protection
        authority.
      </p>

      <h2 id="children">Children</h2>
      <p>
        The apps are not directed to children under 13, and you must be at
        least 13 &mdash; or older where the law of your country requires &mdash;
        to create an account. If we learn that a child under 13 has created an
        account, we&apos;ll delete it. Information a church records about
        children in its care, such as children&apos;s check-in, is entered by
        church staff and held for the church, as described above.
      </p>

      <h2 id="security">Security</h2>
      <p>
        We protect information with encryption in transit, access controls that
        limit each account and each church to its own information, and secure
        storage for sign-in credentials on your device (the iPhone Keychain and
        Android&apos;s encrypted storage). No system is perfectly secure, so we
        can&apos;t guarantee that information will never be accessed without
        permission, but we work to prevent it and will notify you where the law
        requires.
      </p>

      <h2 id="international">Where information is processed</h2>
      <p>
        FaithForm and its service providers may process your information in the
        United States and in other countries, which may have different data
        protection laws than where you live. Where the law requires, we use
        appropriate safeguards for those transfers.
      </p>

      <h2 id="changes">Changes to this policy</h2>
      <p>
        When we update this policy, we&apos;ll change the effective date at the
        top of this page. If a change is significant, the apps will ask you to
        review and accept the updated policy before you continue.
      </p>

      <h2 id="contact">Contact us</h2>
      <p>
        Questions or requests about your privacy? Email{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
      </p>
    </LegalDocument>
  );
}
