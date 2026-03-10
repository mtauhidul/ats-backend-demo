/**
 * Backfill script: Create candidate documents for approved applications
 * that have no corresponding candidate in the candidates collection.
 *
 * Run with: npx ts-node src/scripts/backfill-approved-applications.ts
 */

import * as admin from "firebase-admin";
import * as path from "path";

const serviceAccount = require(path.resolve(
  __dirname,
  "../../firebase-service-account.json"
));

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function calculateYearsOfExperience(experiences: any[]): number {
  if (!experiences || experiences.length === 0) return 0;
  let totalMonths = 0;
  for (const exp of experiences) {
    if (!exp.duration) continue;
    const durationStr = exp.duration.trim();
    const isPresentJob = /present|current/i.test(durationStr);
    const dateMatch = durationStr.match(
      /(\w+\s+)?(\d{4})\s*[-–]\s*(\w+\s+)?(\d{4}|present|current)/i
    );
    if (dateMatch) {
      const startYear = parseInt(dateMatch[2]);
      const startMonth = dateMatch[1]
        ? new Date(dateMatch[1] + " 1").getMonth()
        : 0;
      let endYear: number;
      let endMonth: number;
      if (isPresentJob) {
        const now = new Date();
        endYear = now.getFullYear();
        endMonth = now.getMonth();
      } else {
        endYear = parseInt(dateMatch[4]);
        endMonth = dateMatch[3]
          ? new Date(dateMatch[3] + " 1").getMonth()
          : 11;
      }
      totalMonths += Math.max(
        0,
        (endYear - startYear) * 12 + (endMonth - startMonth)
      );
    }
  }
  return Math.round((totalMonths / 12) * 10) / 10;
}

function filterCertifications(certifications: string[]): string[] {
  if (!certifications || certifications.length === 0) return [];
  return certifications.filter((cert) => {
    if (cert.length > 100) return false;
    if (
      /proficient in|strong foundation|experience with|skilled in|expertise in|knowledge of/i.test(
        cert
      )
    )
      return false;
    return true;
  });
}

function buildCandidateFromApplication(
  app: admin.firestore.DocumentData,
  appId: string
): any {
  const parsedData = app.parsedData || {};
  const ensureArray = (d: any): any[] => {
    if (!d) return [];
    if (Array.isArray(d)) return d;
    if (typeof d === "object") return Object.values(d);
    return [];
  };

  const candidateData: any = {
    applicationIds: [appId],
    jobIds: app.jobId ? [app.jobId] : [],
    firstName: app.firstName,
    lastName: app.lastName,
    email: app.email,
    phone: app.phone || null,
    avatar: app.photo || null,
    resumeUrl: app.resumeUrl || app.resume?.url || null,
    resumeOriginalName:
      app.resumeOriginalName || app.resume?.name || null,
    source: "application",
    status: "active",
    isActive: true,
    totalEmailsSent: 0,
    totalEmailsReceived: 0,
    categoryIds: [],
    tagIds: [],
    clientIds: app.clientId ? [app.clientId] : [],
    videoIntroUrl: app.videoIntroUrl || null,
    videoIntroFilename: app.videoIntroFilename || null,
    videoIntroDuration: app.videoIntroDuration || null,
    videoIntroFileSize: app.videoIntroFileSize || null,
    coverLetter: app.coverLetter || null,
    rawEmailBody: app.rawEmailBody || null,
    rawEmailBodyHtml: app.rawEmailBodyHtml || null,
  };

  // Skills
  const skills = ensureArray(parsedData.skills);
  if (skills.length > 0) {
    candidateData.skills = skills.map((s: any) =>
      typeof s === "string" ? { name: s } : s
    );
  } else {
    candidateData.skills = [];
  }

  // Experience
  const experiences = ensureArray(parsedData.experience);
  if (experiences.length > 0) {
    candidateData.workExperience = experiences.map((exp: any) => ({
      company: exp.company || "",
      title: exp.title || "",
      duration: exp.duration || "",
      description: Array.isArray(exp.description)
        ? exp.description.join(" ")
        : exp.description || "",
    }));
    const yoe = calculateYearsOfExperience(experiences);
    if (yoe > 0) candidateData.yearsOfExperience = yoe;
  } else {
    candidateData.workExperience = [];
    candidateData.yearsOfExperience = 0;
  }

  // Education
  const education = ensureArray(parsedData.education);
  if (education.length > 0) {
    candidateData.education = education.map((edu: any) => ({
      institution: edu.institution || "",
      degree: edu.degree || "",
      field: edu.field || "",
      year: edu.year || "",
    }));
  } else {
    candidateData.education = [];
  }

  // Certifications
  const certs = ensureArray(parsedData.certifications);
  candidateData.certifications = filterCertifications(certs);

  // Languages
  const langs = ensureArray(parsedData.languages);
  candidateData.languages = langs.map((l: any) =>
    typeof l === "string" ? { name: l } : l
  );

  // Summary/notes
  if (parsedData.summary) candidateData.notes = parsedData.summary;

  // Job application record
  candidateData.jobApplications = app.jobId
    ? [
        {
          jobId: app.jobId,
          applicationId: appId,
          status: "active",
          appliedAt: app.createdAt || new Date(),
          lastStatusChange: new Date(),
          currentStage: null,
          emailIds: [],
          emailsSent: 0,
          emailsReceived: 0,
        },
      ]
    : [];

  return candidateData;
}

// ------------------------------------------------------------
// Main
// ------------------------------------------------------------

async function main() {
  console.log("=== Backfill: Approved Applications → Candidates ===\n");

  // 1. Fetch all approved applications
  const appsSnap = await db
    .collection("applications")
    .where("status", "==", "approved")
    .get();

  console.log(`Total approved applications: ${appsSnap.size}`);

  const orphaned: { appId: string; candidateId: string | null; name: string }[] =
    [];

  // 2. Find which ones have no candidate document
  for (const appDoc of appsSnap.docs) {
    const data = appDoc.data();
    const linkedCandidateId = data.candidateId || null;

    if (!linkedCandidateId) {
      orphaned.push({ appId: appDoc.id, candidateId: null, name: `${data.firstName} ${data.lastName}` });
      continue;
    }

    const cDoc = await db.collection("candidates").doc(linkedCandidateId).get();
    if (!cDoc.exists) {
      orphaned.push({
        appId: appDoc.id,
        candidateId: linkedCandidateId,
        name: `${data.firstName} ${data.lastName}`,
      });
    }
  }

  if (orphaned.length === 0) {
    console.log("\n✅ No orphaned applications found — all good!\n");
    return;
  }

  console.log(`\n⚠️  Found ${orphaned.length} approved application(s) with no candidate document:`);
  orphaned.forEach((o) =>
    console.log(`  - ${o.name} (appId: ${o.appId}, linkedCandidateId: ${o.candidateId || "NONE"})`)
  );

  // Dry-run guard: set to true to actually write
  const WRITE = true;

  if (!WRITE) {
    console.log("\n⛔ DRY RUN — set WRITE=true to apply changes.");
    return;
  }

  console.log("\n▶  Creating candidate documents...\n");

  let created = 0;
  let failed = 0;

  for (const orphan of orphaned) {
    const appDoc = appsSnap.docs.find((d) => d.id === orphan.appId)!;
    const appData = appDoc.data();

    try {
      const candidatePayload = buildCandidateFromApplication(appData, orphan.appId);
      const timestamp = admin.firestore.FieldValue.serverTimestamp();

      let candidateRef: admin.firestore.DocumentReference;

      // If the application already has a candidateId (doc was deleted), reuse that ID
      if (orphan.candidateId) {
        candidateRef = db.collection("candidates").doc(orphan.candidateId);
      } else {
        candidateRef = db.collection("candidates").doc();
      }

      await candidateRef.set({
        ...candidatePayload,
        id: candidateRef.id,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      // Update the application to store the (possibly new) candidateId
      await db.collection("applications").doc(orphan.appId).update({
        candidateId: candidateRef.id,
        updatedAt: timestamp,
      });

      // If application has a jobId, add this candidate to the job's candidateIds array
      if (appData.jobId) {
        const jobRef = db.collection("jobs").doc(appData.jobId);
        const jobDoc = await jobRef.get();
        if (jobDoc.exists) {
          const existingIds: string[] = jobDoc.data()?.candidateIds || [];
          if (!existingIds.includes(candidateRef.id)) {
            await jobRef.update({
              candidateIds: admin.firestore.FieldValue.arrayUnion(candidateRef.id),
              updatedAt: timestamp,
            });
          }
        }
      }

      console.log(`  ✅ Created candidate ${candidateRef.id} for ${orphan.name}`);
      created++;
    } catch (err: any) {
      console.error(`  ❌ Failed for ${orphan.name} (${orphan.appId}):`, err.message);
      failed++;
    }
  }

  console.log(`\n=== Done: ${created} created, ${failed} failed ===\n`);
}

main().catch(console.error).finally(() => process.exit(0));
