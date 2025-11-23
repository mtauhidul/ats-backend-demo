import { getFirestoreDB } from '../src/config/firebase';

async function checkUnprocessedEmails() {
  const db = getFirestoreDB();
  
  console.log('\n🔍 Checking email accounts and fetching fresh emails...\n');
  
  // Get email accounts
  const accountsSnapshot = await db.collection('emailAccounts')
    .where('isActive', '==', true)
    .get();
  
  if (accountsSnapshot.empty) {
    console.log('❌ No active email accounts found');
    return;
  }
  
  console.log(`Found ${accountsSnapshot.size} active email account(s)\n`);
  
  for (const accountDoc of accountsSnapshot.docs) {
    const account = accountDoc.data();
    console.log('Account:', account.email);
    console.log('Last checked:', account.lastCheckedAt?.toDate());
    
    try {
      // Fetch emails directly from IMAP
      const imapService = require('../src/services/imap.service').default;
      
      console.log('  Fetching unread emails from IMAP server...');
      const emails = await imapService.fetchUnreadEmails(account, 100);
      
      console.log(`  Found ${emails.length} unread email(s)\n`);
      
      // Look for Hannah's email
      const hannahEmails = emails.filter((email: any) => {
        const from = email.from.toLowerCase();
        return from.includes('suareznami');
      });
      
      if (hannahEmails.length > 0) {
        console.log(`  ⚠️  Found ${hannahEmails.length} unprocessed email(s) from Hannah:\n`);
        
        hannahEmails.forEach((email: any, idx: number) => {
          console.log(`  Email ${idx + 1}:`);
          console.log('    From:', email.from);
          console.log('    Subject:', email.subject);
          console.log('    Date:', email.date);
          console.log('    Attachments:', email.attachments?.length || 0);
          
          if (email.attachments && email.attachments.length > 0) {
            email.attachments.forEach((att: any, i: number) => {
              const isVideo = att.contentType?.includes('video') ||
                att.filename?.toLowerCase().endsWith('.mp4') ||
                att.filename?.toLowerCase().endsWith('.mov');
              
              console.log(`      ${i+1}. ${att.filename} ${isVideo ? '🎥 VIDEO!' : ''}`);
              console.log(`         Type: ${att.contentType}`);
              console.log(`         Size: ${(att.content?.length / 1024 / 1024).toFixed(2)} MB`);
            });
          }
          console.log('');
        });
      }
      
    } catch (error: any) {
      console.log('  ❌ Error fetching emails:', error.message);
    }
    
    console.log('');
  }
  
  process.exit(0);
}

checkUnprocessedEmails().catch(err => {
  console.error('❌ Error:', err);
  process.exit(1);
});
