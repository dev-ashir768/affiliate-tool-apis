import * as React from "react";
import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import { emailBrand } from "./brand.js";

type EmailLayoutProps = {
  preview: string;
  logoUrl: string;
  children: React.ReactNode;
  footerNote?: string;
};

export function EmailLayout({
  preview,
  logoUrl,
  children,
  footerNote,
}: EmailLayoutProps) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body
        style={{
          margin: 0,
          padding: "32px 16px",
          backgroundColor: emailBrand.background,
          fontFamily: emailBrand.fontFamily,
          color: emailBrand.foreground,
        }}
      >
        <Container
          style={{
            maxWidth: "520px",
            margin: "0 auto",
            backgroundColor: emailBrand.card,
            borderRadius: "12px",
            border: `1px solid ${emailBrand.border}`,
            overflow: "hidden",
          }}
        >
          <Section
            style={{
              padding: "28px 32px 16px",
              textAlign: "center" as const,
              borderBottom: `1px solid ${emailBrand.border}`,
            }}
          >
            <Img
              src={logoUrl}
              width="140"
              height="auto"
              alt={emailBrand.name}
              style={{ margin: "0 auto", display: "block" }}
            />
          </Section>

          <Section style={{ padding: "28px 32px 8px" }}>{children}</Section>

          <Hr style={{ borderColor: emailBrand.border, margin: "8px 0 0" }} />

          <Section style={{ padding: "20px 32px 28px" }}>
            <Text
              style={{
                margin: 0,
                fontSize: "12px",
                lineHeight: "18px",
                color: emailBrand.muted,
                textAlign: "center" as const,
              }}
            >
              {footerNote ??
                `You’re receiving this because of activity on your ${emailBrand.productName} account.`}
            </Text>
            <Text
              style={{
                margin: "8px 0 0",
                fontSize: "12px",
                color: emailBrand.muted,
                textAlign: "center" as const,
              }}
            >
              © {new Date().getFullYear()} {emailBrand.name}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export function EmailHeading({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{
        margin: "0 0 12px",
        fontSize: "22px",
        fontWeight: 700,
        lineHeight: "28px",
        color: emailBrand.foreground,
      }}
    >
      {children}
    </Text>
  );
}

export function EmailParagraph({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{
        margin: "0 0 16px",
        fontSize: "15px",
        lineHeight: "24px",
        color: emailBrand.foreground,
      }}
    >
      {children}
    </Text>
  );
}

export function EmailButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Section style={{ textAlign: "center" as const, margin: "24px 0" }}>
      <Link
        href={href}
        style={{
          display: "inline-block",
          backgroundColor: emailBrand.primary,
          color: "#FFFFFF",
          fontSize: "15px",
          fontWeight: 600,
          textDecoration: "none",
          padding: "12px 28px",
          borderRadius: "8px",
        }}
      >
        {children}
      </Link>
    </Section>
  );
}

export function EmailMuted({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{
        margin: "0 0 8px",
        fontSize: "13px",
        lineHeight: "20px",
        color: emailBrand.muted,
        wordBreak: "break-all" as const,
      }}
    >
      {children}
    </Text>
  );
}
