import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";

/** Shared shell so every transactional email reads as one product. */
export function EmailShell({
  preview,
  heading,
  children,
}: {
  preview: string;
  heading: string;
  children: React.ReactNode;
}) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: "#f6f5f2", fontFamily: "Georgia, serif", margin: 0 }}>
        <Container
          style={{
            backgroundColor: "#ffffff",
            margin: "24px auto",
            padding: "32px",
            maxWidth: "560px",
            border: "1px solid #e5e2da",
          }}
        >
          <Heading style={{ fontSize: "22px", color: "#1c1b18", marginTop: 0 }}>
            {heading}
          </Heading>
          {children}
          <Section style={{ marginTop: "32px", borderTop: "1px solid #e5e2da", paddingTop: "16px" }}>
            <Text style={{ fontSize: "12px", color: "#8a867c", margin: 0 }}>
              Wanderwall — walkable galleries for your work.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

export function P({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{ fontSize: "15px", lineHeight: "24px", color: "#3a382f" }}>{children}</Text>
  );
}

export function CtaLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      style={{
        display: "inline-block",
        backgroundColor: "#1c1b18",
        color: "#ffffff",
        padding: "10px 20px",
        fontSize: "14px",
        textDecoration: "none",
      }}
    >
      {children}
    </Link>
  );
}
