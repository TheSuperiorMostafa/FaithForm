export const BOOTSTRAP_SUPERADMIN_EMAILS = ["superiormostafa@gmail.com"];

export function isBootstrapSuperAdminEmail(email: string | null | undefined) {
  if (!email) return false;
  return BOOTSTRAP_SUPERADMIN_EMAILS.includes(email.toLowerCase());
}
