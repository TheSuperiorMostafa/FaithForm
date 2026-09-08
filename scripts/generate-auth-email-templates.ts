/**
 * Renders the Supabase Auth email templates from FaithForm's own email layout.
 *
 * The sign-in, confirmation and password-reset emails are sent by Supabase, not
 * by this codebase, so they cannot import the layout at run time — they live as
 * HTML pasted into the Supabase dashboard. Left to drift, they are the emails a
 * person sees *first*, in FaithForm's default blue-link-on-white, before they
 * have ever seen the product.
 *
 * So they are generated here instead of written by hand. Same shell, same
 * navy, same gold, same logo as every other message; the only difference is
 * that the URL is one of Supabase's Go template variables rather than a real
 * link. Re-run after any change to lib/email/layout.ts and paste the output
 * back in.
 *
 *   NEXT_PUBLIC_SITE_URL=https://faithform.io npx tsx scripts/generate-auth-email-templates.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { renderEmail, type EmailDocument } from "../lib/email/layout";

/**
 * Supabase substitutes these before sending. They pass through the layout's
 * HTML escaping untouched because they contain no markup-significant
 * characters — verified by the generator below.
 */
const CONFIRMATION_URL = "{{ .ConfirmationURL }}";
const TOKEN = "{{ .Token }}";

const OUT_DIR = "docs/email/supabase";

/** Where each file goes in Supabase → Authentication → Emails. */
type Template = {
  file: string;
  supabaseTemplate: string;
  subject: string;
  doc: EmailDocument;
};

const IGNORE_NOTE =
  "If you did not request this, you can ignore this email — nothing will change.";

const templates: Template[] = [
  {
    file: "magic-link.html",
    supabaseTemplate: "Magic Link",
    subject: "Your FaithForm sign-in link",
    doc: {
      title: "Your FaithForm sign-in link",
      preheader: "One tap to sign in. This link expires in one hour.",
      heading: "Sign in to FaithForm",
      blocks: [
        {
          kind: "paragraph",
          text: "Use the button below to sign in. No password needed.",
        },
        { kind: "button", label: "Sign in to FaithForm", url: CONFIRMATION_URL },
        {
          kind: "muted",
          text: "This link expires in one hour and can only be used once. Open it on the same device and browser you asked from.",
        },
        { kind: "muted", text: IGNORE_NOTE },
      ],
      permissionNote:
        "You received this because someone asked to sign in to FaithForm with this address.",
    },
  },
  {
    file: "confirm-signup.html",
    supabaseTemplate: "Confirm signup",
    subject: "Confirm your email address",
    doc: {
      title: "Confirm your email address",
      preheader: "One step left — confirm your address to finish setting up.",
      heading: "Confirm your email address",
      blocks: [
        {
          kind: "paragraph",
          text: "Welcome to FaithForm. Confirm this address and your account is ready to use.",
        },
        { kind: "button", label: "Confirm my email", url: CONFIRMATION_URL },
        { kind: "muted", text: "This link expires in 24 hours." },
        { kind: "muted", text: IGNORE_NOTE },
      ],
      permissionNote:
        "You received this because this address was used to create a FaithForm account.",
    },
  },
  {
    file: "reset-password.html",
    supabaseTemplate: "Reset Password",
    subject: "Reset your FaithForm password",
    doc: {
      title: "Reset your FaithForm password",
      preheader: "Choose a new password. This link expires in one hour.",
      heading: "Reset your password",
      blocks: [
        {
          kind: "paragraph",
          text: "Use the button below to choose a new password for your FaithForm account.",
        },
        { kind: "button", label: "Choose a new password", url: CONFIRMATION_URL },
        {
          kind: "muted",
          text: "This link expires in one hour and can only be used once.",
        },
        {
          kind: "muted",
          text: "If you did not ask to reset your password, you can ignore this email — your current password still works.",
        },
      ],
      permissionNote:
        "You received this because a password reset was requested for this address.",
    },
  },
  {
    file: "invite-user.html",
    supabaseTemplate: "Invite user",
    subject: "You've been invited to FaithForm",
    doc: {
      title: "You've been invited to FaithForm",
      preheader: "Accept your invitation and set up your account.",
      heading: "You've been invited to FaithForm",
      blocks: [
        {
          kind: "paragraph",
          text: "Someone at your church has invited you to FaithForm. Accept the invitation to set up your account.",
        },
        { kind: "button", label: "Accept the invitation", url: CONFIRMATION_URL },
        { kind: "muted", text: IGNORE_NOTE },
      ],
      permissionNote:
        "You received this because someone at your church invited this address to FaithForm.",
    },
  },
  {
    file: "change-email.html",
    supabaseTemplate: "Change Email Address",
    subject: "Confirm your new email address",
    doc: {
      title: "Confirm your new email address",
      preheader: "Confirm this address to finish the change.",
      heading: "Confirm your new email address",
      blocks: [
        {
          kind: "paragraph",
          text: "Confirm this address to finish changing the email on your FaithForm account.",
        },
        { kind: "button", label: "Confirm this address", url: CONFIRMATION_URL },
        {
          kind: "muted",
          text: "If you did not ask to change your email, ignore this and contact your church admin — your address will not change.",
        },
      ],
      permissionNote:
        "You received this because this address was set as the new email on a FaithForm account.",
    },
  },
  {
    file: "reauthentication.html",
    supabaseTemplate: "Reauthentication",
    subject: "Your FaithForm verification code",
    doc: {
      title: "Your FaithForm verification code",
      preheader: "Your one-time verification code.",
      heading: "Your verification code",
      blocks: [
        { kind: "paragraph", text: "Enter this code to confirm it is you." },
        {
          kind: "callout",
          title: "Verification code",
          rows: [{ label: "Code", value: TOKEN, mono: true }],
        },
        { kind: "muted", text: "This code expires shortly and can only be used once." },
        { kind: "muted", text: IGNORE_NOTE },
      ],
      permissionNote:
        "You received this because a sensitive change was requested on a FaithForm account.",
    },
  },
];

mkdirSync(OUT_DIR, { recursive: true });

const index: string[] = [
  "# Supabase Auth email templates",
  "",
  "Generated by `scripts/generate-auth-email-templates.ts` from the same",
  "`lib/email/layout.ts` every other FaithForm email uses. Do not hand-edit the",
  "HTML in this folder — change the layout or the generator and re-run:",
  "",
  "```bash",
  "NEXT_PUBLIC_SITE_URL=https://faithform.io npx tsx scripts/generate-auth-email-templates.ts",
  "```",
  "",
  "Paste each file into **Supabase → Authentication → Emails**, into the template",
  "named below, and set the subject line alongside it.",
  "",
  "| File | Supabase template | Subject |",
  "| --- | --- | --- |",
];

for (const template of templates) {
  const { html } = renderEmail(template.doc);

  // The Go variables must survive the layout's HTML escaping intact, or
  // Supabase substitutes nothing and every link in the email is dead.
  for (const variable of [CONFIRMATION_URL, TOKEN]) {
    const usedInDoc = JSON.stringify(template.doc).includes(variable);
    if (usedInDoc && !html.includes(variable)) {
      throw new Error(
        `${template.file}: ${variable} did not survive rendering — check escapeHtml`,
      );
    }
  }

  writeFileSync(`${OUT_DIR}/${template.file}`, html, "utf8");
  index.push(
    `| \`${template.file}\` | ${template.supabaseTemplate} | ${template.subject} |`,
  );
  console.log(`wrote ${OUT_DIR}/${template.file}  (${html.length} bytes)`);
}

index.push(
  "",
  "## Note on the redirect",
  "",
  "These templates use `{{ .ConfirmationURL }}`, which carries whatever",
  "`redirect_to` the app requested — but only if that destination is on the",
  "project's **Redirect URLs** allow-list. Anything not on the list is silently",
  "replaced with the project's Site URL, path and all, which is what broke",
  "sign-in before. Keep the list in step with",
  "`contracts/faithful/v1/auth-callback.json`.",
  "",
);

writeFileSync(`${OUT_DIR}/README.md`, index.join("\n"), "utf8");
console.log(`wrote ${OUT_DIR}/README.md`);
