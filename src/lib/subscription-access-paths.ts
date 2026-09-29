/** Merchant app paths reachable before an active subscription / trial. */
export function merchantHrefAllowedWithoutProductAccess(href: string): boolean {
  const path = (href.split("?")[0] ?? href).trim();
  if (path === "/onboarding" || path.startsWith("/onboarding/")) return true;
  if (path === "/billing" || path.startsWith("/billing/")) return true;
  return false;
}
