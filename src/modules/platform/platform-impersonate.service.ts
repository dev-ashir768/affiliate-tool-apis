import { mintMerchantSessionForTarget } from "./mint-merchant-session.js";

export async function impersonateOrganizationMember(input: {
  actorUserId: string;
  targetUserId: string;
  organizationId: string;
}) {
  return mintMerchantSessionForTarget({
    ...input,
    auditAction: "auth.impersonate",
  });
}
