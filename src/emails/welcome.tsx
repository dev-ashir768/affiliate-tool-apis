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
  recipientName: string;
  organizationName: string;
  homeUrl: string;
};

export function WelcomeEmail({
  logoUrl,
  recipientName,
  organizationName,
  homeUrl,
}: Props) {
  return (
    <EmailLayout
      preview="Welcome to Tiksly"
      logoUrl={logoUrl}
      footerNote="Choose a plan to unlock shops, bots, and outreach."
    >
      <EmailHeading>Welcome to Tiksly</EmailHeading>
      <EmailParagraph>Hi {recipientName},</EmailParagraph>
      <EmailParagraph>
        Your workspace <strong>{organizationName}</strong> is ready. Pick a
        subscription to connect TikTok shops and start creator outreach.
      </EmailParagraph>
      <EmailButton href={homeUrl}>Choose a plan</EmailButton>
      <EmailMuted>Or copy this link: {homeUrl}</EmailMuted>
    </EmailLayout>
  );
}
