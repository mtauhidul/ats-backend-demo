import { Button, Heading, Link, Text } from "@react-email/components";
import * as React from "react";
import { EmailLayout } from "./components/EmailLayout";

interface InvitationEmailProps {
  firstName: string;
  companyName: string;
  invitedBy: string;
  inviteUrl: string;
}

export const InvitationEmail = ({
  firstName,
  companyName,
  invitedBy,
  inviteUrl,
}: InvitationEmailProps) => {
  const previewText = `Join ${companyName} on Arista ATS`;

  return (
    <EmailLayout preview={previewText}>
      <Heading className="mx-0 my-[30px] p-0 text-center font-normal text-[24px] text-black">
        Join <strong>{companyName}</strong> on <strong>Arista ATS</strong>
      </Heading>

      <Text className="text-[14px] text-black leading-6">
        Hello {firstName},
      </Text>

      <Text className="text-[14px] text-black leading-6">
        <strong>{invitedBy}</strong> has invited you to join{" "}
        <strong>{companyName}</strong> on Arista ATS.
      </Text>

      <div
        style={{
          backgroundColor: "#eff6ff",
          padding: "20px",
          borderRadius: "8px",
          border: "1px solid #bfdbfe",
          margin: "20px 0",
        }}
      >
        <Text className="text-[14px] text-[#1e40af] m-0">
          Arista ATS is an applicant tracking system that helps teams manage
          their hiring process efficiently. You can track candidates, schedule
          interviews, and collaborate with your team all in one place.
        </Text>
      </div>

      <div style={{ textAlign: "center", margin: "32px 0" }}>
        <Button
          className="rounded bg-[#71abbf] px-5 py-3 text-center font-semibold text-[12px] text-white no-underline"
          href={inviteUrl}
        >
          Accept Invitation
        </Button>
      </div>

      <Text className="text-[14px] text-black leading-6">
        or copy and paste this URL into your browser:{" "}
        <Link href={inviteUrl} className="text-[#71abbf] no-underline">
          {inviteUrl}
        </Link>
      </Text>

      <Text className="text-[#666666] text-[12px] leading-6">
        This invitation link will expire in 7 days. If you have any questions,
        please contact {invitedBy}.
      </Text>
    </EmailLayout>
  );
};
