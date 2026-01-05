import Imap from 'imap';
import { simpleParser } from 'mailparser';
import { emailAccountService, IEmailAccount } from '../services/firestore/emailAccount.service';
import { decrypt } from '../utils/crypto';

/**
 * Script to fetch raw email from IMAP
 * Usage: npx ts-node src/scripts/fetch-raw-email.ts
 */

// Number of emails to fetch (most recent)
const FETCH_COUNT = 50; // Fetch more to find the specific sender

// Target email account (leave empty to fetch from first active account)
const TARGET_EMAIL = 'resumes@aristagroups.com';

// Filter by sender email (leave empty to show all)
const FILTER_BY_SENDER = 'donlancelotknight123@gmail.com';

async function fetchRawEmails() {
  console.log('🔍 Loading email accounts from Firestore...\n');
  
  // Get email account
  let emailAccount: IEmailAccount | null;
  if (TARGET_EMAIL) {
    emailAccount = await emailAccountService.findByEmail(TARGET_EMAIL);
    if (!emailAccount) {
      console.error(`❌ Email account not found: ${TARGET_EMAIL}`);
      console.log('Available accounts:');
      const allAccounts = await emailAccountService.findAll();
      allAccounts.forEach((acc: IEmailAccount) => console.log(`  - ${acc.email}`));
      process.exit(1);
    }
  } else {
    const activeAccounts = await emailAccountService.findActive();
    if (activeAccounts.length === 0) {
      console.error('❌ No active email accounts found');
      process.exit(1);
    }
    emailAccount = activeAccounts[0];
  }

  console.log('✅ Email account loaded:');
  console.log(`   Email: ${emailAccount.email}`);
  console.log(`   Provider: ${emailAccount.provider}`);
  console.log(`   IMAP Host: ${emailAccount.imapHost}:${emailAccount.imapPort}`);
  console.log(`   Active: ${emailAccount.isActive}\n`);

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

      imap.openBox('INBOX', true, (err, box) => {
        if (err) {
          console.error('❌ Error opening inbox:', err);
          reject(err);
          return;
        }

        console.log(`📬 Inbox opened. Total messages: ${box.messages.total}\n`);

        if (box.messages.total === 0) {
          console.log('📭 No messages in inbox');
          imap.end();
          resolve([]);
          return;
        }

        // Fetch the most recent emails
        const fetchRange = `${Math.max(1, box.messages.total - FETCH_COUNT + 1)}:${box.messages.total}`;
        console.log(`🔍 Fetching messages: ${fetchRange}\n`);
        console.log('='.repeat(80));

        const fetch = imap.seq.fetch(fetchRange, {
          bodies: '',
          struct: true,
        });

        let emailCount = 0;

        fetch.on('message', (msg, seqno) => {
          emailCount++;
          console.log(`\n${'='.repeat(80)}`);
          console.log(`📨 EMAIL #${emailCount} (Sequence: ${seqno})`);
          console.log('='.repeat(80));

          let buffer = '';

          msg.on('body', (stream) => {
            stream.on('data', (chunk) => {
              buffer += chunk.toString('utf8');
            });

            stream.once('end', async () => {
              try {
                // Parse the email
                const parsed = await simpleParser(buffer);

                // Filter by sender if specified
                if (FILTER_BY_SENDER) {
                  const fromEmail = parsed.from?.value?.[0]?.address?.toLowerCase();
                  if (fromEmail !== FILTER_BY_SENDER.toLowerCase()) {
                    console.log(`⏭️  Skipping email from: ${fromEmail}`);
                    return;
                  }
                }

                console.log('\n📋 METADATA:');
                console.log('─'.repeat(80));
                console.log(`From: ${parsed.from?.text || 'N/A'}`);
                console.log(`To: ${Array.isArray(parsed.to) ? parsed.to.map(a => a.text).join(', ') : parsed.to?.text || 'N/A'}`);
                console.log(`Subject: ${parsed.subject || 'N/A'}`);
                console.log(`Date: ${parsed.date || 'N/A'}`);
                console.log(`Message-ID: ${parsed.messageId || 'N/A'}`);

                if (parsed.cc) {
                  console.log(`CC: ${Array.isArray(parsed.cc) ? parsed.cc.map(a => a.text).join(', ') : parsed.cc.text}`);
                }
                if (parsed.bcc) {
                  console.log(`BCC: ${Array.isArray(parsed.bcc) ? parsed.bcc.map(a => a.text).join(', ') : parsed.bcc.text}`);
                }

                console.log('\n📎 ATTACHMENTS:');
                console.log('─'.repeat(80));
                if (parsed.attachments && parsed.attachments.length > 0) {
                  parsed.attachments.forEach((att, idx) => {
                    console.log(`  ${idx + 1}. ${att.filename} (${att.contentType}, ${att.size} bytes)`);
                  });
                } else {
                  console.log('  No attachments');
                }

                console.log('\n📝 EMAIL BODY (Text):');
                console.log('─'.repeat(80));
                console.log(parsed.text || 'No text body');

                console.log('\n🌐 EMAIL BODY (HTML):');
                console.log('─'.repeat(80));
                if (parsed.html) {
                  // Show first 500 characters of HTML
                  const htmlPreview = parsed.html.substring(0, 500);
                  console.log(htmlPreview);
                  if (parsed.html.length > 500) {
                    console.log(`\n... (${parsed.html.length - 500} more characters)`);
                  }
                } else {
                  console.log('No HTML body');
                }

                console.log('\n📬 RAW EMAIL HEADERS:');
                console.log('─'.repeat(80));
                if (parsed.headers) {
                  parsed.headers.forEach((value, key) => {
                    console.log(`${key}: ${value}`);
                  });
                }

                console.log('\n📄 RAW EMAIL (First 1000 chars):');
                console.log('─'.repeat(80));
                console.log(buffer.substring(0, 1000));
                if (buffer.length > 1000) {
                  console.log(`\n... (${buffer.length - 1000} more characters)`);
                }

                console.log('\n💾 FULL RAW EMAIL:');
                console.log('─'.repeat(80));
                console.log(buffer);

              } catch (parseErr) {
                console.error('❌ Error parsing email:', parseErr);
              }
            });
          });
        });

        fetch.once('error', (err: Error) => {
          console.error('❌ Fetch error:', err);
          reject(err);
        });

        fetch.once('end', () => {
          console.log(`\n${'='.repeat(80)}`);
          if (FILTER_BY_SENDER) {
            console.log(`✅ Finished processing emails (filtered by: ${FILTER_BY_SENDER})`);
          } else {
            console.log(`✅ Finished fetching ${emailCount} email(s)`);
          }
          console.log('='.repeat(80));
          imap.end();
        });
      });
    });

    imap.once('error', (err: Error) => {
      console.error('❌ IMAP error:', err);
      reject(err);
    });

    imap.once('end', () => {
      console.log('\n🔌 Connection closed');
      resolve(null);
    });

    imap.connect();
  });
}

// Run the script
console.log('🚀 Starting email fetch script...\n');

fetchRawEmails()
  .then(() => {
    console.log('\n✨ Script completed successfully');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Script failed:', err);
    process.exit(1);
  });
