import * as React from "react";
import {
  EmailButton,
  EmailHeading,
  EmailLayout,
  EmailMuted,
  EmailParagraph,
} from "./layout.js";

type Props = {
  logoUrl: string;
  inviteUrl: string;
  organizationName: string;
  role: string;
  inviterName?: string;
};

export function OrgInviteEmail({
  logoUrl,
  inviteUrl,
  organizationName,
  role,
  inviterName,
}: Props) {
  return (
    <EmailLayout
      preview={`Join ${organizationName} on Tiksly`}
      logoUrl={logoUrl}
      footerNote="If you weren’t expecting this invite, you can ignore this email."
    >
      <EmailHeading>You’re invited</EmailHeading>
      <EmailParagraph>
        {inviterName
          ? `${inviterName} invited you to join `
          : "You’ve been invited to join "}
        <strong>{organizationName}</strong> on Tiksly as{" "}
        <strong>{role}</strong>.
      </EmailParagraph>
      <EmailButton href={inviteUrl}>Accept invite</EmailButton>
      <EmailMuted>Or copy this link: {inviteUrl}</EmailMuted>
    </EmailLayout>
  );
}
