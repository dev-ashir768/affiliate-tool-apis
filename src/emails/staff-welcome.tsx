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
  loginUrl: string;
  name: string;
  role: string;
  temporaryPassword?: string;
};

export function StaffWelcomeEmail({
  logoUrl,
  loginUrl,
  name,
  role,
  temporaryPassword,
}: Props) {
  return (
    <EmailLayout
      preview="Your Tiksly backoffice access"
      logoUrl={logoUrl}
      footerNote="Keep your credentials private. Contact a SUPERADMIN if you need help."
    >
      <EmailHeading>Welcome to the backoffice</EmailHeading>
      <EmailParagraph>Hi {name},</EmailParagraph>
      <EmailParagraph>
        You’ve been added as platform staff with the role{" "}
        <strong>{role}</strong>. Sign in to manage the Tiksly platform.
      </EmailParagraph>
      {temporaryPassword ? (
        <>
          <EmailParagraph>
            Temporary password: <strong>{temporaryPassword}</strong>
          </EmailParagraph>
          <EmailParagraph>
            Please change it after your first login.
          </EmailParagraph>
        </>
      ) : null}
      <EmailButton href={loginUrl}>Open backoffice login</EmailButton>
      <EmailMuted>Or copy this link: {loginUrl}</EmailMuted>
    </EmailLayout>
  );
}
