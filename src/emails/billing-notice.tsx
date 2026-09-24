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
  preview: string;
  title: string;
  greeting: string;
  paragraphs: string[];
  detailLines?: string[];
  ctaLabel: string;
  ctaUrl: string;
  footerNote?: string;
};

export function BillingNoticeEmail({
  logoUrl,
  preview,
  title,
  greeting,
  paragraphs,
  detailLines,
  ctaLabel,
  ctaUrl,
  footerNote,
}: Props) {
  return (
    <EmailLayout
      preview={preview}
      logoUrl={logoUrl}
      footerNote={
        footerNote ??
        "You’re receiving this because of billing activity on your Tiksly organization."
      }
    >
      <EmailHeading>{title}</EmailHeading>
      <EmailParagraph>{greeting}</EmailParagraph>
      {paragraphs.map((p, i) => (
        <EmailParagraph key={i}>{p}</EmailParagraph>
      ))}
      {detailLines && detailLines.length > 0 ? (
        <EmailParagraph>
          {detailLines.map((line, i) => (
            <React.Fragment key={i}>
              {i > 0 ? <br /> : null}
              {line}
            </React.Fragment>
          ))}
        </EmailParagraph>
      ) : null}
      <EmailButton href={ctaUrl}>{ctaLabel}</EmailButton>
      <EmailMuted>Or copy this link: {ctaUrl}</EmailMuted>
    </EmailLayout>
  );
}
