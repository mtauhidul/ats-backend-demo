import { Button, Heading, Text } from "@react-email/components";
import * as React from "react";
import { EmailLayout } from "./components/EmailLayout";

interface InterviewNotificationProps {
  candidateName: string;
  jobTitle: string;
  interviewTitle: string;
  interviewType: string;
  scheduledAt: Date;
  duration: number;
  meetingLink?: string;
  meetingPassword?: string;
  interviewerNames?: string[];
  isInstant?: boolean;
  companyName?: string;
}

export const InterviewNotification = ({
  candidateName,
  jobTitle,
  interviewTitle,
  interviewType,
  scheduledAt,
  duration,
  meetingLink,
  meetingPassword,
  interviewerNames,
  isInstant = false,
  companyName = 'Arista',
}: InterviewNotificationProps) => {
  const scheduledDate = new Date(scheduledAt);
  const formattedDate = scheduledDate.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const formattedTime = scheduledDate.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });

  const interviewTypeDisplay =
    interviewType === "video"
      ? "Video Interview"
      : interviewType === "phone"
        ? "Phone Interview"
        : interviewType === "in-person"
          ? "In-Person Interview"
          : "Interview";

  const previewText = isInstant
    ? `Instant Interview - ${jobTitle}`
    : `Interview Scheduled: ${jobTitle}`;

  return (
    <EmailLayout preview={previewText} companyName={companyName}>
      <Heading className="mx-0 my-[30px] p-0 text-center font-normal text-[24px] text-black">
        📅 Interview Scheduled{" "}
        {isInstant && (
          <span
            style={{
              background: "#10b981",
              color: "white",
              padding: "4px 12px",
              borderRadius: "12px",
              fontSize: "12px",
              fontWeight: "bold",
              marginLeft: "10px",
            }}
          >
            INSTANT
          </span>
        )}
      </Heading>

      <Text className="text-[14px] text-black leading-6">
        Hello {candidateName},
      </Text>

      <Text className="text-[14px] text-black leading-6">
        {isInstant ? (
          <>
            <strong>Great news!</strong> An instant interview has been created
            for you. The meeting is starting soon!
          </>
        ) : (
          <>
            <strong>Great news!</strong> Your interview has been scheduled for
            the <strong>{jobTitle}</strong> position at <strong>{companyName}</strong>.
          </>
        )}
      </Text>

      <div
        style={{
          background: "white",
          borderLeft: "4px solid #2563eb",
          padding: "20px",
          margin: "20px 0",
          borderRadius: "6px",
          backgroundColor: "#f9fafb",
        }}
      >
        <Text className="text-[16px] font-bold text-[#1e40af] mt-0 mb-3">
          Interview Details
        </Text>
        <Text className="text-[14px] text-black m-0 mb-2">
          <strong>Position:</strong> {jobTitle}
        </Text>
        <Text className="text-[14px] text-black m-0 mb-2">
          <strong>Interview:</strong> {interviewTitle}
        </Text>
        <Text className="text-[14px] text-black m-0 mb-2">
          <strong>Type:</strong> {interviewTypeDisplay}
        </Text>
        <Text className="text-[14px] text-black m-0 mb-2">
          <strong>Date:</strong> {formattedDate}
        </Text>
        <Text className="text-[14px] text-black m-0 mb-2">
          <strong>Time:</strong> {formattedTime}
        </Text>
        <Text className="text-[14px] text-black m-0 mb-2">
          <strong>Duration:</strong> {duration} minutes
        </Text>
        {interviewerNames && interviewerNames.length > 0 && (
          <Text className="text-[14px] text-black m-0">
            <strong>Interviewer(s):</strong> {interviewerNames.join(", ")}
          </Text>
        )}
      </div>

      {meetingLink && (
        <div
          style={{
            background: "#f0f9ff",
            border: "2px solid #3b82f6",
            borderRadius: "8px",
            padding: "20px",
            margin: "20px 0",
          }}
        >
          <Text className="text-[16px] font-bold text-[#1e40af] mt-0 mb-3">
            🎥 Video Meeting
          </Text>
          <div style={{ textAlign: "center", margin: "16px 0" }}>
            <Button
              className="rounded bg-[#2563eb] px-5 py-3 text-center font-semibold text-[12px] text-white no-underline"
              href={meetingLink}
            >
              Join Meeting
            </Button>
          </div>
          {meetingPassword && (
            <Text className="text-[14px] text-[#1e40af] m-0 mb-2">
              <strong>Password:</strong> {meetingPassword}
            </Text>
          )}
          <Text className="text-[#6b7280] text-[12px] m-0">
            💡 Make sure you have Zoom installed or join via browser
          </Text>
        </div>
      )}

      <Text className="text-[14px] text-black leading-6">
        Please join on time. If you need to reschedule, contact us as soon as
        possible.
      </Text>

      <Text className="text-[14px] text-black leading-6">
        Good luck with your interview!
      </Text>
    </EmailLayout>
  );
};
