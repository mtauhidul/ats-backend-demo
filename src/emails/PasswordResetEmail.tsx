import { Button, Heading, Text } from "@react-email/components";
import * as React from "react";
import { EmailLayout } from "./components/EmailLayout";

interface PasswordResetEmailProps {
  firstName: string;
  resetUrl: string;
}

export const PasswordResetEmail = ({
  firstName,
  resetUrl,
}: PasswordResetEmailProps) => {
  const previewText = "Reset your Arista ATS password";

  return (
    <EmailLayout preview={previewText}>
      <Heading className="mx-0 my-[30px] p-0 text-center font-normal text-[24px] text-black">
        Reset Your Password
      </Heading>

      <Text className="text-[14px] text-black leading-6">
        Hello {firstName},
      </Text>

      <Text className="text-[14px] text-black leading-6">
        We received a request to reset your password for your Arista ATS account.
        Click the button below to create a new password.
      </Text>

      <div style={{ textAlign: "center", margin: "32px 0" }}>
        <Button
          className="rounded bg-[#dc2626] px-5 py-3 text-center font-semibold text-[12px] text-white no-underline"
          href={resetUrl}
        >
          Reset Password
        </Button>
      </div>

      <Text className="text-[14px] text-black leading-6">
        This link will expire in 1 hour for security reasons.
      </Text>

      <Text className="text-[#666666] text-[12px] leading-6 mt-4">
        If you didn't request a password reset, you can safely ignore this
        email. Your password will remain unchanged.
      </Text>
    </EmailLayout>
  );
};
