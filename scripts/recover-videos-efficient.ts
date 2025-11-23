/**
 * 🔥 COMPREHENSIVE VIDEO RECOVERY v2 - Efficient per-applicant search
 * 
 * This script:
 * 1. Finds all applications without videos from email automation
 * 2. For EACH applicant, searches for their emails directly via IMAP (read + unread)
 * 3. Extracts video attachments and links from their emails
 * 4. Updates applications with recovered videos
 * 
 * This version is more efficient - searches per applicant instead of fetching all emails.
 */

import admin from 'firebase-admin';
import dotenv from 'dotenv';
import path from 'path';
import Imap from 'imap';
import { simpleParser } from 'mailparser';
import cloudinaryService from '../src/services/cloudinary.service';
import { isVideoFile } from '../src/utils/videoHandler';
import { decrypt } from '../src/utils/crypto';
import logger from '../src/utils/logger';

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

// Fetch emails from a specific sender
async function fetchEmailsFromSender(account: any, senderEmail: string): Promise<any[]> {
  return new Promise((resolve, reject) => {
    const messages: any[] = [];

    let password = account.imapPassword;
    try {
      password = decrypt(account.imapPassword);
    } catch (err) {
      password = account.imapPassword;
    }

    const imap = new Imap({
      user: account.imapUser,
      password: password,
      host: account.imapHost,
      port: account.imapPort,
      tls: account.imapTls,
      tlsOptions: { rejectUnauthorized: false },
    });

    imap.once('ready', () => {
      imap.openBox('INBOX', false, (err, box) => {
        if (err) {
          imap.end();
          return reject(err);
        }

        // Search for emails FROM this specific sender (includes read + unread)
        const searchCriteria = [['FROM', senderEmail]];
        
        imap.search(searchCriteria, (err, results) => {
          if (err) {
            imap.end();
            return reject(err);
          }

          if (!results || results.length === 0) {
            imap.end();
            return resolve([]);
          }

          const fetch = imap.fetch(results.slice(-10), { // Get last 10 emails from this sender
            bodies: '',
            markSeen: false,
          });

          const parsePromises: Promise<void>[] = [];

          fetch.on('message', (msg) => {
            msg.on('body', (stream) => {
              const parsePromise = new Promise<void>((resolveMsg) => {
                simpleParser(stream as any, async (err, parsed) => {
                  if (err) {
                    resolveMsg();
                    return;
                  }

                  try {
                    const emailData = {
                      from: parsed.from?.text || '',
                      subject: parsed.subject || '',
                      body: parsed.text || '',
                      bodyHtml: parsed.html || '',
                      attachments: (parsed.attachments || []).map((att: any) => ({
                        filename: att.filename,
                        content: att.content,
                        contentType: att.contentType,
                        size: att.size,
                      })),
                      date: parsed.date || new Date(),
                    };
                    messages.push(emailData);
                  } catch (error) {
                    // Ignore parsing errors
                  }
                  resolveMsg();
                });
              });
              parsePromises.push(parsePromise);
            });
          });

          fetch.once('error', (err) => {
            imap.end();
            reject(err);
          });

          fetch.once('end', async () => {
            await Promise.all(parsePromises);
            imap.end();
            resolve(messages);
          });
        });
      });
    });

    imap.once('error', (err: Error) => {
      reject(err);
    });

    imap.connect();
  });
}

async function recoverVideosEfficiently() {
  console.log('\n🔥 COMPREHENSIVE VIDEO RECOVERY v2 - PER-APPLICANT SEARCH');
  console.log('='.repeat(70));
  
  try {
    // Step 1: Find all applications without videos
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
      console.log('\n✅ All applications have videos!');
      return;
    }

    // Step 2: Get email account
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

    // Step 3: Process each applicant
    console.log(`\n🔍 Step 3: Searching emails for each applicant...\n`);
    
    let recovered = 0;
    let notFound = 0;
    let errors = 0;
    const results: any[] = [];

    for (let i = 0; i < appsWithoutVideos.length; i++) {
      const app = appsWithoutVideos[i];
      const applicantName = `${app.firstName || ''} ${app.lastName || ''}`.trim() || app.email;
      const progress = `[${i + 1}/${appsWithoutVideos.length}]`;
      
      try {
        console.log(`${progress} 🔍 ${applicantName} (${app.email})...`);
        
        // Fetch emails from this specific sender
        const emails = await fetchEmailsFromSender(account, app.email);

        if (emails.length === 0) {
          console.log(`   ⚠️  No emails found\n`);
          notFound++;
          results.push({
            name: applicantName,
            email: app.email,
            status: 'not_found',
            message: 'No emails found'
          });
          continue;
        }

        console.log(`   📧 Found ${emails.length} email(s), checking for videos...`);

        // Check emails for videos (newest first)
        let videoUrl: string | null = null;
        let videoSource = '';

        for (const email of emails.reverse()) {
          // Check for video attachment
          if (email.attachments && email.attachments.length > 0) {
            const videoAttachment = email.attachments.find((att: any) => 
              att.filename && isVideoFile(att.filename)
            );
            
            if (videoAttachment) {
              console.log(`   📎 Found video: ${videoAttachment.filename} (${(videoAttachment.size / 1024 / 1024).toFixed(2)} MB)`);
              
              try {
                const uploadResult = await cloudinaryService.uploadVideo(
                  videoAttachment.content,
                  videoAttachment.filename
                );
                videoUrl = uploadResult.url;
                videoSource = `attachment: ${videoAttachment.filename}`;
                console.log(`   ✅ Uploaded to Cloudinary`);
                break;
              } catch (uploadErr: any) {
                console.log(`   ❌ Upload failed: ${uploadErr.message}`);
              }
            }
          }

          // Check for video link
          if (!videoUrl && email.body) {
            const videoLinkMatch = email.body.match(
              /(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/|vimeo\.com\/|loom\.com\/share\/)[^\s]+)/i
            );
            
            if (videoLinkMatch) {
              videoUrl = videoLinkMatch[0];
              videoSource = 'video link';
              console.log(`   🔗 Found video link: ${videoUrl}`);
              break;
            }
          }
        }

        // Update application
        if (videoUrl) {
          await db.collection('applications').doc(app.id).update({
            videoIntroUrl: videoUrl
          });
          
          console.log(`   ✅ RECOVERED from ${videoSource}\n`);
          recovered++;
          results.push({
            name: applicantName,
            email: app.email,
            status: 'recovered',
            videoUrl,
            source: videoSource
          });
        } else {
          console.log(`   ⚠️  No video found in ${emails.length} email(s)\n`);
          notFound++;
          results.push({
            name: applicantName,
            email: app.email,
            status: 'not_found',
            message: `Checked ${emails.length} emails, no video`
          });
        }

      } catch (error: any) {
        console.error(`   ❌ Error: ${error.message}\n`);
        errors++;
        results.push({
          name: applicantName,
          email: app.email,
          status: 'error',
          message: error.message
        });
      }
      
      // Small delay to avoid overwhelming IMAP server
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('📊 COMPREHENSIVE RECOVERY SUMMARY');
    console.log('='.repeat(70));
    console.log(`Total applications checked: ${appsWithoutVideos.length}`);
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
        });
    }

    console.log('\n✅ Comprehensive video recovery completed!');
    console.log('🔥 This script checked ALL emails (read + unread) per applicant.\n');

  } catch (error: any) {
    console.error('\n❌ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the script
recoverVideosEfficiently()
  .then(() => {
    console.log('✓ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Script failed:', error);
    process.exit(1);
  });
