import { getFirestoreDB } from '../src/config/firebase';

async function reprocessAllMissingVideos() {
  const db = getFirestoreDB();
  
  console.log('\n🎥 COMPREHENSIVE VIDEO RECOVERY FROM IMAP SERVER\n');
  console.log('================================================\n');
  
  // Step 1: Get all email automation applications without videos
  console.log('📋 Step 1: Finding applications without videos...\n');
  
  const appsSnapshot = await db.collection('applications')
    .where('source', '==', 'email_automation')
    .get();
  
  const appsWithoutVideos: any[] = [];
  
  appsSnapshot.forEach(doc => {
    const app = doc.data();
    if (!app.videoIntroUrl) {
      appsWithoutVideos.push({
        id: doc.id,
        email: app.email,
        firstName: app.firstName,
        lastName: app.lastName,
        appliedAt: app.appliedAt,
      });
    }
  });
  
  console.log(`Found ${appsWithoutVideos.length} applications without videos\n`);
  
  if (appsWithoutVideos.length === 0) {
    console.log('✅ All applications have videos!\n');
    process.exit(0);
  }
  
  // Step 2: Connect to IMAP and fetch ALL emails
  console.log('📧 Step 2: Connecting to IMAP server...\n');
  
  const accountsSnapshot = await db.collection('emailAccounts')
    .where('isActive', '==', true)
    .get();
  
  if (accountsSnapshot.empty) {
    console.log('❌ No active email accounts found\n');
    process.exit(1);
  }
  
  const account = accountsSnapshot.docs[0].data();
  console.log('Using account:', account.email, '\n');
  
  const imapService = require('../src/services/imap.service').default;
  
  // Fetch more emails to ensure we get all
  console.log('📥 Fetching emails from IMAP server (this may take a while)...\n');
  const allEmails = await imapService.fetchUnreadEmails(account, 500);
  
  console.log(`Fetched ${allEmails.length} unread emails\n`);
  console.log('================================================\n');
  
  // Step 3: Process each application
  let recovered = 0;
  let notFound = 0;
  let errors = 0;
  
  for (const app of appsWithoutVideos) {
    console.log(`\n📄 Processing: ${app.firstName} ${app.lastName} (${app.email})`);
    console.log(`   Application ID: ${app.id}`);
    
    try {
      // Find email from this applicant
      const applicantEmails = allEmails.filter((email: any) => {
        const from = email.from.toLowerCase();
        const emailAddr = app.email.toLowerCase();
        return from.includes(emailAddr);
      });
      
      if (applicantEmails.length === 0) {
        console.log(`   ⚠️  No unread email found from ${app.email}`);
        notFound++;
        continue;
      }
      
      console.log(`   ✓ Found ${applicantEmails.length} email(s)`);
      
      // Look for video in any of their emails
      let videoUrl: string | null = null;
      let foundInEmail: any = null;
      
      for (const email of applicantEmails) {
        // Check for video attachment
        const videoAttachment = email.attachments?.find((att: any) =>
          att.contentType?.includes('video') ||
          att.filename?.toLowerCase().endsWith('.mp4') ||
          att.filename?.toLowerCase().endsWith('.mov') ||
          att.filename?.toLowerCase().endsWith('.avi') ||
          att.filename?.toLowerCase().endsWith('.webm') ||
          att.filename?.toLowerCase().endsWith('.mkv')
        );
        
        if (videoAttachment) {
          console.log(`   📹 Found video attachment: ${videoAttachment.filename}`);
          
          // Upload video to Cloudinary
          try {
            const cloudinaryService = require('../src/services/cloudinary.service').default;
            const uploadResult = await cloudinaryService.uploadVideo(
              videoAttachment.content,
              videoAttachment.filename
            );
            videoUrl = uploadResult.url;
            foundInEmail = email;
            console.log(`   ✅ Uploaded to Cloudinary: ${videoUrl}`);
            break;
          } catch (uploadError: any) {
            console.log(`   ❌ Upload failed: ${uploadError.message}`);
          }
        }
        
        // Check for video link in body
        if (!videoUrl && email.body) {
          const videoLinkMatch = email.body.match(
            /(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|vimeo\.com\/|loom\.com\/share\/)[^\s<>"]+)/i
          );
          
          if (videoLinkMatch) {
            videoUrl = videoLinkMatch[0];
            foundInEmail = email;
            console.log(`   📹 Found video link: ${videoUrl}`);
            break;
          }
        }
      }
      
      if (!videoUrl) {
        console.log(`   ⚠️  No video found in any email`);
        notFound++;
        continue;
      }
      
      // Update application with video
      await db.collection('applications').doc(app.id).update({
        videoIntroUrl: videoUrl,
        updatedAt: new Date(),
      });
      
      console.log(`   ✅ Updated application with video!`);
      recovered++;
      
      // Mark email as read
      if (foundInEmail && foundInEmail.uid) {
        try {
          await imapService.markAsRead(account, [foundInEmail.uid]);
        } catch (markError) {
          // Non-critical error, continue
        }
      }
      
    } catch (error: any) {
      console.log(`   ❌ Error: ${error.message}`);
      errors++;
    }
  }
  
  // Final Summary
  console.log('\n\n================================================');
  console.log('📊 RECOVERY SUMMARY');
  console.log('================================================');
  console.log(`Total applications checked: ${appsWithoutVideos.length}`);
  console.log(`✅ Videos recovered: ${recovered}`);
  console.log(`⚠️  Not found: ${notFound}`);
  console.log(`❌ Errors: ${errors}`);
  console.log('================================================\n');
  
  if (recovered > 0) {
    console.log('✅ Video recovery completed successfully!\n');
  } else {
    console.log('⚠️  No videos were recovered. Consider:');
    console.log('   1. Checking if emails have been marked as read');
    console.log('   2. Verifying emails contain video attachments or links');
    console.log('   3. Asking applicants to resend videos\n');
  }
  
  process.exit(0);
}

reprocessAllMissingVideos().catch(err => {
  console.error('\n❌ Fatal error:', err);
  process.exit(1);
});
