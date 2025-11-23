import { getFirestoreDB } from '../src/config/firebase';

async function checkHannah() {
  const db = getFirestoreDB();
  
  console.log('\n📄 CHECKING HANNAH SUAREZ\n');
  console.log('================================\n');
  
  // Find Hannah's application
  const appsSnapshot = await db.collection('applications')
    .where('email', '==', 'suareznami@gmail.com')
    .get();
  
  if (appsSnapshot.empty) {
    console.log('❌ No application found');
    return;
  }
  
  const appDoc = appsSnapshot.docs[0];
  const app = appDoc.data();
  
  console.log('APPLICATION INFO:');
  console.log('  ID:', appDoc.id);
  console.log('  Name:', app.firstName, app.lastName);
  console.log('  Email:', app.email);
  console.log('  Source:', app.source);
  console.log('  Video URL:', app.videoIntroUrl || '❌ MISSING');
  console.log('  Applied At:', app.appliedAt?.toDate());
  console.log('\n');
  
  // Find her emails
  console.log('EMAILS:');
  console.log('--------------------------------\n');
  
  const emailsSnapshot = await db.collection('emails')
    .where('direction', '==', 'inbound')
    .get();
  
  let emailCount = 0;
  emailsSnapshot.forEach(doc => {
    const emailData = doc.data();
    const from = emailData.from;
    const extractedEmail = from.match(/<(.+?)>/) ? from.match(/<(.+?)>/)![1] : from;
    
    if (extractedEmail === app.email || emailData.applicationId === appDoc.id) {
      emailCount++;
      console.log(`Email #${emailCount}:`);
      console.log('  From:', emailData.from);
      console.log('  Subject:', emailData.subject);
      console.log('  Received:', emailData.receivedAt?.toDate());
      console.log('  Has attachments:', emailData.attachments?.length || 0);
      
      if (emailData.attachments && emailData.attachments.length > 0) {
        console.log('\n  Attachments:');
        emailData.attachments.forEach((att: any, i: number) => {
          const isVideo = att.contentType?.includes('video') ||
            att.filename?.toLowerCase().endsWith('.mp4') ||
            att.filename?.toLowerCase().endsWith('.mov') ||
            att.filename?.toLowerCase().endsWith('.avi') ||
            att.filename?.toLowerCase().endsWith('.webm');
          
          console.log(`    ${i+1}. ${att.filename} ${isVideo ? '🎥' : ''}`);
          console.log(`       Type: ${att.contentType}`);
          console.log(`       Size: ${(att.size / 1024 / 1024).toFixed(2)} MB`);
          console.log(`       URL: ${att.url || '❌ NO URL'}`);
        });
      }
      
      // Check body for video links
      if (emailData.body) {
        const videoLinkMatch = emailData.body.match(/(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|vimeo\.com\/|loom\.com\/share\/)[^\s]+)/i);
        if (videoLinkMatch) {
          console.log('\n  📹 Video link in body:', videoLinkMatch[0]);
        }
      }
      
      console.log('\n');
    }
  });
  
  if (emailCount === 0) {
    console.log('❌ No emails found\n');
  }
  
  process.exit(0);
}

checkHannah().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
