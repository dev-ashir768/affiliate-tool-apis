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
  resetUrl: string;
  expiresMinutes: number;
  recipientName?: string;
};

export function PasswordResetEmail({
  logoUrl,
  resetUrl,
  expiresMinutes,
  recipientName,
}: Props) {
  const greeting = recipientName ? `Hi ${recipientName},` : "Hi,";
  return (
    <EmailLayout
      preview="Reset your influxa password"
      logoUrl={logoUrl}
      footerNote="If you didn’t request a password reset, you can ignore this email."
    >
      <EmailHeading>Reset your password</EmailHeading>
      <EmailParagraph>{greeting}</EmailParagraph>
      <EmailParagraph>
        We received a request to reset the password for your Tiksly account.
        Click the button below to choose a new password.
      </EmailParagraph>
      <EmailButton href={resetUrl}>Reset password</EmailButton>
      <EmailParagraph>
        This link expires in {expiresMinutes} minutes.
      </EmailParagraph>
      <EmailMuted>Or copy this link: {resetUrl}</EmailMuted>
    </EmailLayout>
  );
}
