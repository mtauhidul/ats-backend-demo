/**
 * 🔥 COMPREHENSIVE VIDEO RECOVERY - Checks ALL emails (including read)
 * 
 * This script:
 * 1. Finds all applications without videos from email automation
 * 2. Fetches ALL emails (read + unread) from those applicants
 * 3. Extracts video attachments and links from their emails
 * 4. Updates applications with recovered videos
 * 
 * This ensures we never miss a video again, regardless of email read status.
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

interface Application {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  source?: string;
  videoIntroUrl?: string;
  createdAt?: any;
}

async function recoverAllVideosComprehensive() {
  console.log('\n🔥 COMPREHENSIVE VIDEO RECOVERY - ALL EMAILS (READ + UNREAD)');
  console.log('='.repeat(70));
  
  try {
    // Step 1: Find all applications without videos from email automation
    console.log('\n📋 Step 1: Finding applications without videos...');
    const appsSnapshot = await db.collection('applications')
      .where('source', '==', 'email_automation')
      .get();
    
    const appsWithoutVideos: Application[] = [];
    
    appsSnapshot.forEach((doc) => {
      const data = doc.data() as Application;
      if (!data.videoIntroUrl || data.videoIntroUrl.trim() === '') {
        appsWithoutVideos.push({
          ...data,
          id: doc.id
        });
      }
    });
    
    console.log(`✓ Found ${appsWithoutVideos.length} applications without videos`);
    
    if (appsWithoutVideos.length === 0) {
      console.log('\n✅ All applications have videos! No recovery needed.');
      return;
    }

    // Step 2: Get email account configuration
    console.log('\n📧 Step 2: Getting email account configuration...');
    const emailAccountsSnapshot = await db.collection('emailAccounts')
      .where('isActive', '==', true)
      .limit(1)
      .get();
    
    if (emailAccountsSnapshot.empty) {
      throw new Error('No active email account found');
    }
    
    const account = emailAccountsSnapshot.docs[0].data();
    console.log(`✓ Using account: ${account.email}`);

    // Step 3: Extract all applicant emails
    const applicantEmails = appsWithoutVideos.map(app => app.email);
    console.log(`\n📬 Step 3: Searching emails from ${applicantEmails.length} applicants...`);
    
    // Calculate date range (last 6 months to be safe)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    
    console.log(`📅 Date range: Since ${sixMonthsAgo.toISOString().split('T')[0]}`);
    console.log(`🔍 This will check ALL emails (read + unread) from these applicants\n`);

    // Step 4: Fetch ALL emails from these senders (in smaller batches)
    console.log('📥 Fetching emails from IMAP server (this may take a few minutes)...');
    console.log('⏳ Processing emails in batches to avoid timeout...\n');
    
    // Process in batches of 20 applicants at a time
    const batchSize = 20;
    const allEmails: any[] = [];
    
    for (let i = 0; i < applicantEmails.length; i += batchSize) {
      const batch = applicantEmails.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(applicantEmails.length / batchSize);
      
      console.log(`📦 Processing batch ${batchNum}/${totalBatches} (${batch.length} applicants)...`);
      
      try {
        const batchEmails = await imapService.fetchAllEmailsFromSenders(
          account as any,
          batch,
          500, // Limit per batch
          sixMonthsAgo
        );
        
        allEmails.push(...batchEmails);
        console.log(`   ✓ Found ${batchEmails.length} emails from this batch`);
      } catch (error: any) {
        console.log(`   ⚠️  Batch failed: ${error.message}, continuing with next batch...`);
      }
    }
    
    console.log(`\n✓ Total emails found: ${allEmails.length}`);

    // Step 5: Process each application
    console.log('\n🔍 Step 5: Processing applications and matching emails...\n');
    
    let recovered = 0;
    let notFound = 0;
    let errors = 0;
    const results: any[] = [];

    for (const app of appsWithoutVideos) {
      const applicantName = `${app.firstName || ''} ${app.lastName || ''}`.trim() || app.email;
      
      try {
        // Find all emails from this applicant
        const applicantEmails = allEmails.filter((email: any) => {
          const from = email.from.toLowerCase();
          return from.includes(app.email.toLowerCase());
        });

        if (applicantEmails.length === 0) {
          console.log(`⚠️  ${applicantName}: No emails found from ${app.email}`);
          notFound++;
          results.push({
            name: applicantName,
            email: app.email,
            status: 'not_found',
            message: 'No emails found from this sender'
          });
          continue;
        }

        console.log(`🔍 ${applicantName}: Found ${applicantEmails.length} email(s), checking for videos...`);

        // Check all emails for videos (newest first)
        let videoUrl: string | null = null;
        let videoSource = '';

        for (const email of applicantEmails.reverse()) { // Newest first
          // Check for video attachment
          if (email.attachments && email.attachments.length > 0) {
            const videoAttachment = email.attachments.find((att: any) => 
              att.filename && isVideoFile(att.filename)
            );
            
            if (videoAttachment) {
              console.log(`   📎 Found video attachment: ${videoAttachment.filename} (${(videoAttachment.size / 1024 / 1024).toFixed(2)} MB)`);
              
              try {
                const uploadResult = await cloudinaryService.uploadVideo(
                  videoAttachment.content,
                  videoAttachment.filename
                );
                videoUrl = uploadResult.url;
                videoSource = `attachment: ${videoAttachment.filename}`;
                console.log(`   ✅ Uploaded to Cloudinary: ${videoUrl}`);
                break; // Found video, stop searching
              } catch (uploadErr: any) {
                console.log(`   ❌ Upload failed: ${uploadErr.message}`);
              }
            }
          }

          // Check for video link in email body
          if (!videoUrl && email.body) {
            const videoLinkMatch = email.body.match(
              /(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|vimeo\.com\/|loom\.com\/share\/)[^\s]+)/i
            );
            
            if (videoLinkMatch) {
              videoUrl = videoLinkMatch[0];
              videoSource = 'email body link';
              console.log(`   🔗 Found video link: ${videoUrl}`);
              break; // Found video, stop searching
            }
          }
        }

        // Update application if video found
        if (videoUrl) {
          await db.collection('applications').doc(app.id).update({
            videoIntroUrl: videoUrl
          });
          
          console.log(`   ✅ Updated application with video from ${videoSource}\n`);
          recovered++;
          results.push({
            name: applicantName,
            email: app.email,
            status: 'recovered',
            videoUrl,
            source: videoSource
          });
        } else {
          console.log(`   ⚠️  No video found in ${applicantEmails.length} email(s)\n`);
          notFound++;
          results.push({
            name: applicantName,
            email: app.email,
            status: 'not_found',
            message: `Checked ${applicantEmails.length} emails, no video found`
          });
        }

      } catch (error: any) {
        console.error(`❌ ${applicantName}: Error - ${error.message}\n`);
        errors++;
        results.push({
          name: applicantName,
          email: app.email,
          status: 'error',
          message: error.message
        });
      }
    }

    // Step 6: Summary
    console.log('\n' + '='.repeat(70));
    console.log('📊 COMPREHENSIVE RECOVERY SUMMARY');
    console.log('='.repeat(70));
    console.log(`Total applications checked: ${appsWithoutVideos.length}`);
    console.log(`Total emails fetched: ${allEmails.length}`);
    console.log(`✅ Videos recovered: ${recovered}`);
    console.log(`⚠️  Not found: ${notFound}`);
    console.log(`❌ Errors: ${errors}`);
    
    if (recovered > 0) {
      console.log('\n🎉 Successfully recovered videos:');
      results
        .filter(r => r.status === 'recovered')
        .forEach(r => {
          console.log(`   • ${r.name} (${r.email})`);
          console.log(`     Source: ${r.source}`);
          console.log(`     URL: ${r.videoUrl}`);
        });
    }

    if (notFound > 0) {
      console.log(`\n⚠️  ${notFound} applicants still without videos`);
      console.log('Possible reasons:');
      console.log('   • They never sent a video');
      console.log('   • Video was sent through different channel (LinkedIn, etc.)');
      console.log('   • Email was deleted from server');
      console.log('   • Video link expired or was removed');
    }

    console.log('\n✅ Comprehensive video recovery completed!');
    console.log('🔥 This script checked ALL emails (read + unread) from applicants.\n');

  } catch (error: any) {
    console.error('\n❌ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the script
recoverAllVideosComprehensive()
  .then(() => {
    console.log('✓ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
  });
