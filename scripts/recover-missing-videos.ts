import { getFirestoreDB } from '../src/config/firebase';
import { categorizeVideoFile } from '../src/utils/videoHandler';

interface ApplicationWithMissingVideo {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  source: string;
  sourceEmailAccountId?: string;
  videoIntroUrl?: string;
  createdAt: any;
}

interface EmailWithVideo {
  id: string;
  applicationId: string;
  from: string;
  attachments: Array<{
    filename: string;
    url: string;
    contentType: string;
    size: number;
  }>;
  body: string;
}

/**
 * Find all email automation applications without video URLs
 */
async function findApplicationsWithMissingVideos(): Promise<ApplicationWithMissingVideo[]> {
  console.log('🔍 Searching for email automation applications without video URLs...\n');
  
  const db = getFirestoreDB();
  const applicationsSnapshot = await db
    .collection('applications')
    .where('source', '==', 'email_automation')
    .get();
  
  const applicationsWithMissingVideos: ApplicationWithMissingVideo[] = [];
  
  applicationsSnapshot.forEach((doc: any) => {
    const app = doc.data();
    
    // Check if application is missing video URL
    if (!app.videoIntroUrl) {
      applicationsWithMissingVideos.push({
        id: doc.id,
        email: app.email,
        firstName: app.firstName,
        lastName: app.lastName,
        source: app.source,
        sourceEmailAccountId: app.sourceEmailAccountId,
        videoIntroUrl: app.videoIntroUrl,
        createdAt: app.createdAt,
      });
    }
  });
  
  return applicationsWithMissingVideos;
}

/**
 * Find email with video attachment for a specific application
 */
async function findEmailWithVideoForApplication(
  applicationId: string,
  applicantEmail: string
): Promise<EmailWithVideo | null> {
  const db = getFirestoreDB();
  
  // Try to find email by applicationId first
  let emailsSnapshot = await db
    .collection('emails')
    .where('applicationId', '==', applicationId)
    .where('direction', '==', 'inbound')
    .get();
  
  // If not found by applicationId, try by sender email
  if (emailsSnapshot.empty) {
    emailsSnapshot = await db
      .collection('emails')
      .where('from', '==', applicantEmail)
      .where('direction', '==', 'inbound')
      .get();
  }
  
  // If still not found, try extracting email from "from" field with format "Name <email>"
  if (emailsSnapshot.empty) {
    const allEmailsSnapshot = await db
      .collection('emails')
      .where('direction', '==', 'inbound')
      .get();
    
    const matchingEmails: any[] = [];
    allEmailsSnapshot.forEach((doc: any) => {
      const email = doc.data();
      const extractedEmail = email.from.match(/<(.+?)>/)
        ? email.from.match(/<(.+?)>/)![1]
        : email.from;
      
      if (extractedEmail === applicantEmail) {
        matchingEmails.push({ id: doc.id, ...email });
      }
    });
    
    if (matchingEmails.length === 0) {
      return null;
    }
    
    // Find email with video attachment or link
    for (const email of matchingEmails) {
      const hasVideoAttachment = email.attachments?.some((att: any) =>
        isVideoAttachment(att)
      );
      const hasVideoLink = extractVideoLink(email.body) !== null;
      
      if (hasVideoAttachment || hasVideoLink) {
        return email;
      }
    }
    
    return null;
  }
  
  // Check if any of the found emails have video attachments or links
  let emailWithVideo: EmailWithVideo | null = null;
  
  emailsSnapshot.forEach((doc: any) => {
    const email = doc.data();
    
    const hasVideoAttachment = email.attachments?.some((att: any) =>
      isVideoAttachment(att)
    );
    const hasVideoLink = extractVideoLink(email.body) !== null;
    
    if (hasVideoAttachment || hasVideoLink) {
      emailWithVideo = {
        id: doc.id,
        applicationId: email.applicationId,
        from: email.from,
        attachments: email.attachments || [],
        body: email.body,
      };
    }
  });
  
  return emailWithVideo;
}

/**
 * Check if attachment is a video file
 */
function isVideoAttachment(attachment: any): boolean {
  if (!attachment) return false;
  
  return (
    attachment.contentType?.includes('video') ||
    attachment.filename?.toLowerCase().endsWith('.mp4') ||
    attachment.filename?.toLowerCase().endsWith('.mov') ||
    attachment.filename?.toLowerCase().endsWith('.avi') ||
    attachment.filename?.toLowerCase().endsWith('.webm') ||
    attachment.filename?.toLowerCase().endsWith('.mkv')
  );
}

/**
 * Extract video link from email body
 */
function extractVideoLink(body: string): string | null {
  if (!body) return null;
  
  const videoLinkMatch = body.match(
    /(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|vimeo\.com\/|loom\.com\/share\/)[^\s]+)/i
  );
  
  return videoLinkMatch ? videoLinkMatch[0] : null;
}

/**
 * Get video URL from email (attachment or link)
 */
function getVideoUrlFromEmail(email: EmailWithVideo): string | null {
  // First check for video link in body
  const videoLink = extractVideoLink(email.body);
  if (videoLink) {
    return videoLink;
  }
  
  // Then check for video attachment
  const videoAttachment = email.attachments.find((att) =>
    isVideoAttachment(att)
  );
  
  if (videoAttachment && videoAttachment.url) {
    return videoAttachment.url;
  }
  
  return null;
}

/**
 * Update application with video URL
 */
async function updateApplicationWithVideo(
  applicationId: string,
  videoUrl: string,
  dryRun: boolean = false
): Promise<boolean> {
  if (dryRun) {
    console.log(`   [DRY RUN] Would update application ${applicationId} with video: ${videoUrl}`);
    return true;
  }
  
  try {
    const db = getFirestoreDB();
    await db.collection('applications').doc(applicationId).update({
      videoIntroUrl: videoUrl,
      updatedAt: new Date(),
    });
    
    console.log(`   ✅ Updated application with video URL`);
    return true;
  } catch (error: any) {
    console.error(`   ❌ Error updating application: ${error.message}`);
    return false;
  }
}

/**
 * Main recovery function
 */
async function recoverMissingVideos(dryRun: boolean = true) {
  console.log('🎥 VIDEO RECOVERY SCRIPT');
  console.log('========================\n');
  
  if (dryRun) {
    console.log('🔍 DRY RUN MODE - No changes will be made\n');
  } else {
    console.log('⚠️  LIVE MODE - Changes will be applied\n');
  }
  
  // Step 1: Find applications with missing videos
  const applicationsWithMissingVideos = await findApplicationsWithMissingVideos();
  
  console.log(`Found ${applicationsWithMissingVideos.length} applications without video URLs\n`);
  
  if (applicationsWithMissingVideos.length === 0) {
    console.log('✨ No applications need video recovery!');
    return;
  }
  
  // Step 2: Process each application
  let recovered = 0;
  let notFound = 0;
  let errors = 0;
  
  for (const app of applicationsWithMissingVideos) {
    console.log(`\n📄 Processing: ${app.firstName} ${app.lastName} (${app.email})`);
    console.log(`   Application ID: ${app.id}`);
    
    try {
      // Find email with video
      const emailWithVideo = await findEmailWithVideoForApplication(app.id, app.email);
      
      if (!emailWithVideo) {
        console.log(`   ⚠️  No email with video found`);
        notFound++;
        continue;
      }
      
      // Get video URL from email
      const videoUrl = getVideoUrlFromEmail(emailWithVideo);
      
      if (!videoUrl) {
        console.log(`   ⚠️  Email found but no valid video URL`);
        notFound++;
        continue;
      }
      
      console.log(`   📹 Found video: ${videoUrl}`);
      
      // Determine video type
      const videoAttachment = emailWithVideo.attachments.find((att) =>
        isVideoAttachment(att)
      );
      const videoType = videoAttachment
        ? categorizeVideoFile(videoAttachment.filename)
        : 'introduction';
      
      console.log(`   📝 Video type: ${videoType}`);
      
      // Update application
      const success = await updateApplicationWithVideo(app.id, videoUrl, dryRun);
      
      if (success) {
        recovered++;
      } else {
        errors++;
      }
      
    } catch (error: any) {
      console.error(`   ❌ Error processing application: ${error.message}`);
      errors++;
    }
  }
  
  // Summary
  console.log('\n\n📊 RECOVERY SUMMARY');
  console.log('===================');
  console.log(`Total applications checked: ${applicationsWithMissingVideos.length}`);
  console.log(`Videos recovered: ${recovered}`);
  console.log(`Not found: ${notFound}`);
  console.log(`Errors: ${errors}`);
  
  if (dryRun) {
    console.log('\n💡 Run with --live flag to apply changes');
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const isLiveMode = args.includes('--live');

// Run the recovery
recoverMissingVideos(!isLiveMode)
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });
