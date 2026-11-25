/**
 * Who may open a church's invoices.
 *
 * Billing sits beside Connected accounts as the most sensitive Settings
 * section, so it follows the same rule: church admins of that church only.
 * Platform admins may open any church's invoice. Anyone else, including a
 * teammate of the same church without the admin role, is refused.
 *
 * Kept pure so the rule is tested on its own; callers resolve the viewer from
 * a verified session first.
 */
export type InvoiceViewer = {
  /** Set when the caller is a FaithForm platform admin. */
  isPlatformAdmin: boolean;
  /** The church the caller is working in, from their verified membership or impersonation. */
  churchId: string | null;
  /** Whether the caller is an admin of `churchId`. */
  isChurchAdmin: boolean;
};

export function canViewChurchBilling(
  viewer: InvoiceViewer | null,
  invoiceChurchId: string | null | undefined,
): boolean {
  if (!viewer || !invoiceChurchId) return false;
  if (viewer.isPlatformAdmin) return true;
  return Boolean(viewer.churchId) && viewer.churchId === invoiceChurchId && viewer.isChurchAdmin;
}
