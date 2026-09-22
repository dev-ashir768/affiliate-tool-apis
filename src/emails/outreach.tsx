import * as React from "react";
import { Heading, Text } from "@react-email/components";
import { EmailLayout } from "./layout.js";
import { emailBrand } from "./brand.js";

type OutreachEmailProps = {
  logoUrl: string;
  preview: string;
  heading?: string;
  bodyText: string;
};

/** Convert plain outreach body to simple HTML paragraphs. */
export function bodyTextToHtml(bodyText: string): string {
  return bodyText
    .split(/\n{2,}/)
    .map(
      (block) =>
        `<p style="margin:0 0 12px;line-height:1.55;white-space:pre-wrap;">${escapeHtml(
          block.trim(),
        )}</p>`,
    )
    .join("");
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function OutreachEmail({
  logoUrl,
  preview,
  heading,
  bodyText,
}: OutreachEmailProps) {
  const paragraphs = bodyText.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  return (
    <EmailLayout preview={preview} logoUrl={logoUrl}>
      {heading ? (
        <Heading
          as="h1"
          style={{
            margin: "0 0 16px",
            fontSize: "20px",
            fontWeight: 600,
            color: emailBrand.foreground,
          }}
        >
          {heading}
        </Heading>
      ) : null}
      {paragraphs.map((p, i) => (
        <Text
          key={i}
          style={{
            margin: "0 0 12px",
            fontSize: "15px",
            lineHeight: "1.55",
            whiteSpace: "pre-wrap",
            color: emailBrand.foreground,
          }}
        >
          {p}
        </Text>
      ))}
    </EmailLayout>
  );
}
