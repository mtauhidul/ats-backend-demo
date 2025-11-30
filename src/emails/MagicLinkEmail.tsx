import { Button, Heading, Text } from "@react-email/components";
import * as React from "react";
import { EmailLayout } from "./components/EmailLayout";

interface MagicLinkEmailProps {
  firstName: string;
  magicLink: string;
}

export const MagicLinkEmail = ({
  firstName,
  magicLink,
}: MagicLinkEmailProps) => {
  const previewText = "Sign in to Arista ATS";

  return (
    <EmailLayout preview={previewText}>
      <Heading className="mx-0 my-[30px] p-0 text-center font-normal text-[24px] text-black">
        Sign In to Arista ATS
      </Heading>

      <Text className="text-[14px] text-black leading-6">
        Hello {firstName},
      </Text>

      <Text className="text-[14px] text-black leading-6">
        Click the button below to sign in to your account. This link will expire
        in 10 minutes for your security.
      </Text>

      <div style={{ textAlign: "center", margin: "32px 0" }}>
        <Button
          className="rounded bg-[#71abbf] px-5 py-3 text-center font-semibold text-[12px] text-white no-underline"
          href={magicLink}
        >
          Sign In
        </Button>
      </div>

      <div
        style={{
          backgroundColor: "#fef3c7",
          padding: "15px",
          borderRadius: "6px",
          border: "1px solid #fbbf24",
          marginTop: "20px",
        }}
      >
        <Text className="text-[14px] text-[#92400e] m-0">
          🔒 <strong>Security Notice:</strong> This link can only be used once
          and expires in 10 minutes.
        </Text>
      </div>

      <Text className="text-[#666666] text-[12px] leading-6 mt-4">
        If you didn't request this link, you can safely ignore this email.
      </Text>
    </EmailLayout>
  );
};
