/**
 * Quick test to recover Marjon Carl Arevalo's video with fixed filename sanitization
 */

import admin from 'firebase-admin';
import dotenv from 'dotenv';
import path from 'path';
import imapService from '../src/services/imap.service';
import cloudinaryService from '../src/services/cloudinary.service';
import { isVideoFile } from '../src/utils/videoHandler';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const serviceAccount = require('../firebase_config.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function recoverMarjonVideo() {
  console.log('\n🎯 Testing Video Recovery for Marjon Carl Arevalo');
  console.log('='.repeat(60));
  
  try {
    // Get Marjon's application
    const appsSnapshot = await db.collection('applications')
      .where('email', '==', 'mcfa1995@gmail.com')
      .limit(1)
      .get();
    
    if (appsSnapshot.empty) {
      console.log('❌ Marjon not found in applications');
      return;
    }
    
    const app = appsSnapshot.docs[0];
    const appData = app.data();
    
    console.log(`✓ Found application: ${appData.firstName} ${appData.lastName}`);
    console.log(`  Application ID: ${app.id}`);
    console.log(`  Current video: ${appData.videoIntroUrl || 'NONE'}\n`);
    
    // Get email account
    const emailAccountsSnapshot = await db.collection('emailAccounts')
      .where('isActive', '==', true)
      .limit(1)
      .get();
    
    if (emailAccountsSnapshot.empty) {
      throw new Error('No active email account found');
    }
    
    const account = emailAccountsSnapshot.docs[0].data();
    console.log(`📧 Using email account: ${account.email}\n`);
    
    // Fetch ALL emails from Marjon
    console.log('📥 Fetching ALL emails from mcfa1995@gmail.com...');
    const emails = await imapService.fetchAllEmailsFromSenders(
      account as any,
      ['mcfa1995@gmail.com'],
      100,
      new Date('2025-01-01') // Last year
    );
    
    console.log(`✓ Found ${emails.length} email(s)\n`);
    
    if (emails.length === 0) {
      console.log('❌ No emails found');
      return;
    }
    
    // Check emails for video (newest first)
    let videoUrl: string | null = null;
    
    for (const email of emails.reverse()) {
      console.log(`📧 Checking email from: ${email.date.toISOString()}`);
      console.log(`   Subject: ${email.subject}`);
      
      // Check for video attachment
      if (email.attachments && email.attachments.length > 0) {
        console.log(`   📎 Found ${email.attachments.length} attachment(s):`);
        
        for (const att of email.attachments) {
          console.log(`      - ${att.filename} (${(att.size / 1024 / 1024).toFixed(2)} MB)`);
          
          if (att.filename && isVideoFile(att.filename)) {
            console.log(`      🎥 This is a VIDEO file!`);
            console.log(`      📤 Uploading to Cloudinary with sanitized filename...`);
            
            try {
              const uploadResult = await cloudinaryService.uploadVideo(
                att.content,
                att.filename
              );
              
              videoUrl = uploadResult.url;
              console.log(`      ✅ Upload successful!`);
              console.log(`      URL: ${videoUrl}\n`);
              break;
            } catch (uploadErr: any) {
              console.log(`      ❌ Upload failed: ${uploadErr.message}\n`);
            }
          }
        }
        
        if (videoUrl) break;
      }
      
      // Check for video link
      if (!videoUrl && email.body) {
        const videoLinkMatch = email.body.match(
          /(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|vimeo\.com\/|loom\.com\/share\/)[^\s]+)/i
        );
        
        if (videoLinkMatch) {
          videoUrl = videoLinkMatch[0];
          console.log(`   🔗 Found video link: ${videoUrl}\n`);
          break;
        }
      }
      
      console.log('');
    }
    
    // Update application
    if (videoUrl) {
      await db.collection('applications').doc(app.id).update({
        videoIntroUrl: videoUrl
      });
      
      console.log('✅ SUCCESS! Application updated with video URL');
      console.log(`   ${videoUrl}\n`);
    } else {
      console.log('⚠️  No video found in emails\n');
    }
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run
recoverMarjonVideo()
  .then(() => {
    console.log('✓ Test completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Test failed:', error);
    process.exit(1);
  });
