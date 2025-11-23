import { getFirestoreDB } from '../src/config/firebase';

async function manuallyFixHannah() {
  const db = getFirestoreDB();
  
  console.log('\n🔧 MANUALLY FIXING HANNAH SUAREZ VIDEO\n');
  console.log('=======================================\n');
  
  const applicationId = 'h8VaEIujtpkPWk7hxgbY';
  
  // The video URL needs to be provided - check the actual email manually
  console.log('Application ID:', applicationId);
  console.log('\n⚠️  IMPORTANT: You need to manually check the original email for Hannah.');
  console.log('   Email: suareznami@gmail.com');
  console.log('   Subject: Medical Virtual Receptionist - Hannah Mae Suarez');
  console.log('   Sent: Nov 19, 2025');
  console.log('\nOptions:');
  console.log('1. Check the email client directly for the MP4 attachment');
  console.log('2. Re-send the email with the video to resumes@aristagroups.com');
  console.log('3. Ask Hannah to resend with the video');
  console.log('4. Upload the video manually to Cloudinary and update the application\n');
  
  console.log('To update manually, run:');
  console.log('  npx tsx -e "');
  console.log('    import { getFirestoreDB } from \'./src/config/firebase\';');
  console.log('    const db = getFirestoreDB();');
  console.log('    db.collection(\'applications\').doc(\'' + applicationId + '\').update({');
  console.log('      videoIntroUrl: \'YOUR_VIDEO_URL_HERE\',');
  console.log('      updatedAt: new Date()');
  console.log('    }).then(() => console.log(\'Updated!\')).then(() => process.exit(0));');
  console.log('  "');
  console.log('');
  
  // Let's also check if there are any video attachments in ANY email from that day
  console.log('\n🔍 Checking all emails from Nov 19 for video attachments...\n');
  
  const allEmails = await db.collection('emails').get();
  const targetDate = new Date('2025-11-19');
  const targetDateStr = targetDate.toDateString();
  
  let videoEmails = 0;
  allEmails.forEach(doc => {
    const email = doc.data();
    const receivedDate = email.receivedAt?.toDate();
    
    if (receivedDate && receivedDate.toDateString() === targetDateStr) {
      const hasVideo = email.attachments?.some((att: any) => 
        att.contentType?.includes('video') ||
        att.filename?.toLowerCase().endsWith('.mp4') ||
        att.filename?.toLowerCase().endsWith('.mov')
      );
      
      if (hasVideo) {
        videoEmails++;
        console.log('Found video email on Nov 19:');
        console.log('  From:', email.from);
        console.log('  Subject:', email.subject);
        const videoAtt = email.attachments.find((att: any) =>
          att.contentType?.includes('video') ||
          att.filename?.toLowerCase().endsWith('.mp4') ||
          att.filename?.toLowerCase().endsWith('.mov')
        );
        if (videoAtt) {
          console.log('  Video file:', videoAtt.filename);
          console.log('  Video URL:', videoAtt.url || 'NO URL');
        }
        console.log('');
      }
    }
  });
  
  if (videoEmails === 0) {
    console.log('❌ No video attachments found in any emails from Nov 19, 2025\n');
    console.log('This confirms that Hannah\'s video was never captured during email processing.');
    console.log('The video may have been:');
    console.log('  - Too large to be processed');
    console.log('  - In a separate follow-up email');
    console.log('  - Sent through a different channel (LinkedIn, etc.)');
  }
  
  process.exit(0);
}

manuallyFixHannah().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
