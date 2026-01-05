import Imap from 'imap';
import { simpleParser } from 'mailparser';
import { candidateService } from '../services/firestore/candidate.service';
import { applicationService } from '../services/firestore/application.service';
import { emailAccountService, IEmailAccount } from '../services/firestore/emailAccount.service';
import { decrypt } from '../utils/crypto';

/**
 * Backfill raw email body for existing candidates by fetching from IMAP
 * This script finds applications with source='email_automation' that don't have email body,
 * then fetches the original emails from IMAP using the sourceMessageId
 * 
 * Usage: npx ts-node src/scripts/backfill-email-body-from-imap.ts
 */

// Target email account (the one used for email automation)
const TARGET_EMAIL = 'resumes@aristagroups.com';

// Batch size for processing
const BATCH_SIZE = 10;

interface EmailFetchResult {
  messageId: string;
  rawEmailBody?: string;
  rawEmailBodyHtml?: string;
  success: boolean;
  error?: string;
}

async function fetchEmailByMessageId(
  imap: Imap,
  messageId: string
): Promise<EmailFetchResult> {
  return new Promise((resolve) => {
    console.log(`      🔍 Searching for message ID: ${messageId.substring(0, 50)}...`);
    
    // Set timeout for search operation
    const searchTimeout = setTimeout(() => {
      console.log(`      ⏱️  Search timeout (30s)`);
      resolve({ messageId, success: false, error: 'Search timeout' });
    }, 30000);
    
    // Search for email with this Message-ID header
    imap.search([['HEADER', 'MESSAGE-ID', messageId]], (err, results) => {
      clearTimeout(searchTimeout);
      
      if (err) {
        console.error(`      ❌ Search error:`, err.message);
        resolve({ messageId, success: false, error: err.message });
        return;
      }

      if (!results || results.length === 0) {
        console.log(`      ⚠️  Email not found in INBOX`);
        resolve({ messageId, success: false, error: 'Email not found' });
        return;
      }

      console.log(`      ✅ Found email (UID: ${results[0]})`);

      const fetch = imap.fetch(results[0], {
        bodies: '',
        struct: true,
      });

      let emailData: EmailFetchResult = {
        messageId,
        success: false,
      };

      let messageCount = 0;

      fetch.on('message', (msg) => {
        messageCount++;
        msg.on('body', (stream) => {
          simpleParser(stream as any, async (err: any, parsed: any) => {
            if (err) {
              console.error(`      ❌ Parse error:`, err.message);
              emailData.error = err.message;
              return;
            }

            emailData.rawEmailBody = parsed.text || '';
            emailData.rawEmailBodyHtml = parsed.html || parsed.textAsHtml || '';
            emailData.success = true;

            console.log(`      ✅ Parsed email body (text: ${emailData.rawEmailBody?.length || 0} chars, html: ${emailData.rawEmailBodyHtml?.length || 0} chars)`);
          });
        });
      });

      fetch.once('error', (fetchErr: any) => {
        console.error(`      ❌ Fetch error:`, fetchErr.message);
        emailData.error = fetchErr.message;
        resolve(emailData);
      });

      fetch.once('end', () => {
        // Give parser time to complete
        setTimeout(() => {
          if (messageCount === 0) {
            emailData.error = 'No messages fetched';
          }
          resolve(emailData);
        }, 1000);
      });
    });
  });
}

async function connectToImap(emailAccount: IEmailAccount): Promise<Imap> {
  // Decrypt password
  let password = emailAccount.imapPassword;
  try {
    password = decrypt(emailAccount.imapPassword);
    console.log('🔐 Password decrypted successfully\n');
  } catch (err) {
    console.warn('⚠️  Using plain text password (decryption failed)\n');
  }

  const IMAP_CONFIG = {
    user: emailAccount.imapUser,
    password: password,
    host: emailAccount.imapHost,
    port: emailAccount.imapPort,
    tls: emailAccount.imapTls,
    tlsOptions: { rejectUnauthorized: false },
  };

  return new Promise((resolve, reject) => {
    console.log('🔌 Connecting to IMAP server...');
    console.log(`📧 Email: ${IMAP_CONFIG.user}`);
    console.log(`🖥️  Server: ${IMAP_CONFIG.host}:${IMAP_CONFIG.port}\n`);

    const imap = new Imap(IMAP_CONFIG);

    imap.once('ready', () => {
      console.log('✅ Connected to IMAP server\n');
      
      imap.openBox('INBOX', true, (err) => {
        if (err) {
          console.error('❌ Error opening inbox:', err);
          reject(err);
          return;
        }
        console.log('✅ INBOX opened\n');
        resolve(imap);
      });
    });

    imap.once('error', (err: any) => {
      console.error('❌ IMAP connection error:', err);
      reject(err);
    });

    imap.connect();
  });
}

async function backfillEmailBodyFromImap() {
  console.log('🚀 Starting email body backfill from IMAP...\n');
  
  try {
    // Load email account
    console.log('🔍 Loading email account from Firestore...');
    const emailAccount = await emailAccountService.findByEmail(TARGET_EMAIL);
    
    if (!emailAccount) {
      console.error(`❌ Email account not found: ${TARGET_EMAIL}`);
      console.log('Available accounts:');
      const allAccounts = await emailAccountService.findAll();
      allAccounts.forEach((acc: IEmailAccount) => console.log(`  - ${acc.email}`));
      process.exit(1);
    }

    console.log('✅ Email account loaded:');
    console.log(`   Email: ${emailAccount.email}`);
    console.log(`   Provider: ${emailAccount.provider}\n`);

    // Get all applications from email automation without email body
    console.log('📊 Fetching applications that need email body...');
    const emailApplications = await applicationService.find([
      { field: 'source', operator: '==', value: 'email_automation' },
    ]);

    // Filter to only those without email body and with sourceMessageId
    const applicationsToProcess = emailApplications.filter(
      (app) => 
        (!app.rawEmailBody && !app.rawEmailBodyHtml) && 
        app.sourceMessageId
    );

    console.log(`   Total email automation applications: ${emailApplications.length}`);
    console.log(`   Missing email body: ${applicationsToProcess.length}`);
    console.log(`   Already have email body: ${emailApplications.length - applicationsToProcess.length}\n`);

    if (applicationsToProcess.length === 0) {
      console.log('✅ All applications already have email body or no sourceMessageId');
      return;
    }

    // Connect to IMAP
    const imap = await connectToImap(emailAccount);

    let successCount = 0;
    let failCount = 0;
    let noCandidateCount = 0;
    let notFoundInEmailCount = 0;

    // Process in batches
    for (let i = 0; i < applicationsToProcess.length; i += BATCH_SIZE) {
      const batch = applicationsToProcess.slice(i, i + BATCH_SIZE);
      console.log(`\n${'='.repeat(80)}`);
      console.log(`📦 Processing batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(applicationsToProcess.length / BATCH_SIZE)}`);
      console.log(`   Applications ${i + 1}-${Math.min(i + BATCH_SIZE, applicationsToProcess.length)} of ${applicationsToProcess.length}`);
      console.log('='.repeat(80));

      for (const application of batch) {
        try {
          console.log(`\n🔍 Processing: ${application.firstName} ${application.lastName} (${application.email})`);
          console.log(`   Source Message ID: ${application.sourceMessageId}`);

          // Fetch email from IMAP
          const emailResult = await fetchEmailByMessageId(imap, application.sourceMessageId!);

          if (!emailResult.success) {
            console.log(`   ⚠️  Failed to fetch email: ${emailResult.error}`);
            notFoundInEmailCount++;
            continue;
          }

          if (!emailResult.rawEmailBody && !emailResult.rawEmailBodyHtml) {
            console.log(`   ⚠️  Email fetched but no body content`);
            failCount++;
            continue;
          }

          // Update application with email body
          const appUpdateData: any = {};
          if (emailResult.rawEmailBody) {
            appUpdateData.rawEmailBody = emailResult.rawEmailBody;
          }
          if (emailResult.rawEmailBodyHtml) {
            appUpdateData.rawEmailBodyHtml = emailResult.rawEmailBodyHtml;
          }

          await applicationService.update(application.id!, appUpdateData);
          console.log(`   ✅ Updated application with email body`);

          // Find corresponding candidate
          let candidate = null;
          
          if (application.candidateId) {
            candidate = await candidateService.findById(application.candidateId);
          }
          
          if (!candidate) {
            const candidates = await candidateService.find([
              { field: 'email', operator: '==', value: application.email },
            ]);
            
            if (candidates.length > 0) {
              candidate = candidates.find(c => 
                c.applicationIds && c.applicationIds.includes(application.id!)
              ) || candidates[0];
            }
          }

          if (!candidate) {
            console.log(`   ⚠️  No candidate found for this application`);
            noCandidateCount++;
            continue;
          }

          console.log(`   ✅ Found candidate: ${candidate.firstName} ${candidate.lastName}`);

          // Update candidate if doesn't have email body
          if (!candidate.rawEmailBody && !candidate.rawEmailBodyHtml) {
            const candUpdateData: any = {
              ...appUpdateData,
            };

            // Also update source if not set
            if (!candidate.source && application.source) {
              candUpdateData.source = application.source;
            }

            await candidateService.update(candidate.id!, candUpdateData);
            console.log(`   ✅ Updated candidate with email body`);
          } else {
            console.log(`   ⏭️  Candidate already has email body`);
          }

          successCount++;

        } catch (err: any) {
          console.error(`   ❌ Error processing application:`, err.message);
          failCount++;
        }
      }
    }

    // Close IMAP connection
    console.log('\n🔌 Closing IMAP connection...');
    imap.end();

    console.log('\n' + '='.repeat(80));
    console.log('📊 FINAL SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total applications to process: ${applicationsToProcess.length}`);
    console.log(`✅ Successfully updated: ${successCount}`);
    console.log(`⚠️  Email not found in inbox: ${notFoundInEmailCount}`);
    console.log(`⚠️  No candidate found: ${noCandidateCount}`);
    console.log(`❌ Failed: ${failCount}`);
    console.log('='.repeat(80));

    console.log('\n✨ Script completed successfully');

  } catch (error) {
    console.error('\n❌ Script failed:', error);
    throw error;
  }
}

// Run the script
backfillEmailBodyFromImap()
  .then(() => {
    console.log('\n👋 Exiting...');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n💥 Fatal error:', err);
    process.exit(1);
  });
