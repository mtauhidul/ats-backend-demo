import { getFirestoreDB } from '../src/config/firebase';

async function searchAllEmails() {
  const db = getFirestoreDB();
  
  console.log('\n🔍 Searching ALL emails from suareznami@gmail.com...\n');
  
  const allEmails = await db.collection('emails').get();
  
  let found = 0;
  const emailList: any[] = [];
  
  allEmails.forEach(doc => {
    const email = doc.data();
    if (email.from && email.from.toLowerCase().includes('suareznami')) {
      found++;
      emailList.push({
        id: doc.id,
        ...email
      });
    }
  });
  
  console.log(`Found ${found} email(s)\n`);
  console.log('================================\n');
  
  emailList.forEach((email, idx) => {
    console.log(`Email #${idx + 1}:`);
    console.log('  ID:', email.id);
    console.log('  From:', email.from);
    console.log('  To:', email.to);
    console.log('  Subject:', email.subject);
    console.log('  Direction:', email.direction);
    console.log('  Status:', email.status);
    console.log('  Received:', email.receivedAt?.toDate());
    console.log('  Application ID:', email.applicationId || 'N/A');
    console.log('  Attachments:', email.attachments?.length || 0);
    
    if (email.attachments && email.attachments.length > 0) {
      console.log('\n  Attachments:');
      email.attachments.forEach((att: any, i: number) => {
        const isVideo = att.contentType?.includes('video') ||
          att.filename?.toLowerCase().endsWith('.mp4') ||
          att.filename?.toLowerCase().endsWith('.mov') ||
          att.filename?.toLowerCase().endsWith('.avi') ||
          att.filename?.toLowerCase().endsWith('.webm');
        
        console.log(`    ${i+1}. ${att.filename} ${isVideo ? '🎥 VIDEO' : ''}`);
        console.log(`       Type: ${att.contentType}`);
        console.log(`       Size: ${(att.size / 1024 / 1024).toFixed(2)} MB`);
        console.log(`       URL: ${att.url || '❌ NO URL'}`);
      });
    }
    
    // Check for video links in body
    if (email.body) {
      const videoLinkMatch = email.body.match(/(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|vimeo\.com\/|loom\.com\/share\/)[^\s]+)/i);
      if (videoLinkMatch) {
        console.log('\n  📹 Video link found:', videoLinkMatch[0]);
      }
    }
    
    console.log('\n' + '='.repeat(50) + '\n');
  });
  
  process.exit(0);
}

searchAllEmails().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
