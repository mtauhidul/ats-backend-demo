import Imap from 'imap';
import { simpleParser, ParsedMail } from 'mailparser';
import logger from '../utils/logger';
import { InternalServerError } from '../utils/errors';
import { IEmailAccount } from './firestore/emailAccount.service';
import { decrypt } from '../utils/crypto';

export interface EmailMessage {
  from: string;
  to: string[];
  subject: string;
  body: string;
  bodyHtml?: string;
  attachments: Array<{
    filename: string;
    content: Buffer;
    contentType: string;
    size: number;
  }>;
  date: Date;
  messageId: string;
  inReplyTo?: string; // Message ID of the email being replied to
  references?: string[]; // Thread references
}

class IMAPService {
  /**
   * Connect to IMAP server
   */
  private createConnection(emailConfig: {
    host: string;
    port: number;
    user: string;
    password: string;
    tls: boolean;
  }): Imap {
    return new Imap({
      user: emailConfig.user,
      password: emailConfig.password,
      host: emailConfig.host,
      port: emailConfig.port,
      tls: emailConfig.tls,
      tlsOptions: { rejectUnauthorized: false },
    });
  }

  /**
   * Fetch unread emails from inbox
   * 🔥 Hybrid optimization: Uses timeframe filter + duplicate check
   */
  async fetchUnreadEmails(
    emailAccount: IEmailAccount, 
    maxEmails: number = 50,
    sinceDate?: Date // 🔥 NEW: Optional timeframe filter
  ): Promise<EmailMessage[]> {
    return new Promise((resolve, reject) => {
      const messages: EmailMessage[] = [];

      // Try to decrypt password, if it fails, use it as plain text
      let password = emailAccount.imapPassword;
      try {
        password = decrypt(emailAccount.imapPassword);
      } catch (err) {
        logger.warn('[IMAP] Password decryption failed, using plain text password');
        password = emailAccount.imapPassword;
      }

      const imap = this.createConnection({
        host: emailAccount.imapHost,
        port: emailAccount.imapPort,
        user: emailAccount.imapUser,
        password: password,
        tls: emailAccount.imapTls,
      });

      imap.once('ready', () => {
        logger.info('[IMAP] Connection ready, opening INBOX...');
        
        imap.openBox('INBOX', false, (err, box) => {
          if (err) {
            imap.end();
            return reject(new InternalServerError(`Failed to open inbox: ${err.message}`));
          }

          logger.info(`[IMAP] INBOX opened successfully. Total messages: ${box.messages.total}, New: ${box.messages.new}, Unseen: ${box.messages.unseen}`);

          // 🔥 Build search criteria with optional date filter
          const searchCriteria: any[] = ['UNSEEN'];
          
          if (sinceDate) {
            // Format date for IMAP (DD-MMM-YYYY)
            const formattedDate = sinceDate.toISOString().split('T')[0];
            searchCriteria.push(['SINCE', formattedDate]);
            logger.info(`[IMAP] 🔥 Using timeframe filter: SINCE ${formattedDate}`);
          }

          // Search for unread emails (with optional date filter)
          imap.search(searchCriteria, (err, results) => {
            if (err) {
              logger.error('[IMAP] Search error:', err);
              imap.end();
              return reject(new InternalServerError(`Failed to search emails: ${err.message}`));
            }

            logger.info(`[IMAP] Search completed. Found ${results?.length || 0} UNSEEN messages. UIDs: ${JSON.stringify(results)}`);

            if (!results || results.length === 0) {
              logger.warn('[IMAP] No unread emails found, closing connection');
              imap.end();
              return resolve([]);
            }

            // Limit results
            const uids = results.slice(0, maxEmails);
            logger.info(`[IMAP] Fetching ${uids.length} email(s)...`);

            const fetch = imap.fetch(uids, {
              bodies: '',
              markSeen: false, // Don't mark as read yet
            });

            const parsePromises: Promise<void>[] = [];

            fetch.on('message', (msg) => {
              msg.on('body', (stream) => {
                const parsePromise = new Promise<void>((resolveMsg) => {
                  simpleParser(stream as any, async (err, parsed) => {
                    if (err) {
                      logger.error('[IMAP] Email parsing error:', err);
                      resolveMsg();
                      return;
                    }

                    try {
                      const message = this.parseEmail(parsed);
                      messages.push(message);
                      logger.info(`[IMAP] ✓ Parsed email from: ${message.from}`);
                    } catch (error) {
                      logger.error('[IMAP] Error processing email:', error);
                    }
                    resolveMsg();
                  });
                });
                parsePromises.push(parsePromise);
              });
            });

            fetch.once('error', (err) => {
              logger.error('[IMAP] Fetch error:', err);
              imap.end();
              reject(new InternalServerError(`Failed to fetch emails: ${err.message}`));
            });

            fetch.once('end', async () => {
              logger.info('[IMAP] Fetch completed, waiting for parsing...');
              await Promise.all(parsePromises);
              logger.info(`[IMAP] ✓ All emails parsed. Total: ${messages.length}`);
              imap.end();
              resolve(messages);
            });
          });
        });
      });

      imap.once('error', (err: Error) => {
        logger.error('[IMAP] Connection error:', err);
        reject(new InternalServerError(`IMAP connection failed: ${err.message}`));
      });

      logger.info(`[IMAP] Connecting to ${emailAccount.imapHost}:${emailAccount.imapPort} as ${emailAccount.imapUser}...`);
      imap.connect();
    });
  }

  /**
   * Fetch emails by date range (for bulk import)
   */
  async fetchEmailsByDateRange(
    emailAccount: IEmailAccount, 
    startDate: Date, 
    endDate: Date,
    maxEmails: number = 500
  ): Promise<EmailMessage[]> {
    return new Promise((resolve, reject) => {
      const messages: EmailMessage[] = [];

      // Try to decrypt password, if it fails, use it as plain text
      let password = emailAccount.imapPassword;
      try {
        password = decrypt(emailAccount.imapPassword);
      } catch (err) {
        logger.warn('[IMAP] Password decryption failed, using plain text password');
        password = emailAccount.imapPassword;
      }

      const imap = this.createConnection({
        host: emailAccount.imapHost,
        port: emailAccount.imapPort,
        user: emailAccount.imapUser,
        password: password,
        tls: emailAccount.imapTls,
      });

      imap.once('ready', () => {
        logger.info(`[IMAP] Bulk import connection ready, opening INBOX...`);
        
        imap.openBox('INBOX', false, (err, box) => {
          if (err) {
            imap.end();
            return reject(new InternalServerError(`Failed to open inbox: ${err.message}`));
          }

          logger.info(`[IMAP] INBOX opened for bulk import. Total messages: ${box.messages.total}`);

          // Format dates for IMAP search (DD-MMM-YYYY format)
          const formatImapDate = (date: Date): string => {
            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const day = date.getDate();
            const month = months[date.getMonth()];
            const year = date.getFullYear();
            return `${day}-${month}-${year}`;
          };

          const sinceDate = formatImapDate(startDate);
          const beforeDate = formatImapDate(new Date(endDate.getTime() + 86400000)); // Add 1 day to include end date

          logger.info(`[IMAP] Searching for emails from ${sinceDate} to ${beforeDate}`);

          // Search for emails in date range with attachments (likely resumes)
          imap.search([
            ['SINCE', sinceDate],
            ['BEFORE', beforeDate],
            ['UNSEEN']  // Only unread emails
          ], (err, results) => {
            if (err) {
              logger.error('[IMAP] Search error:', err);
              imap.end();
              return reject(new InternalServerError(`Failed to search emails: ${err.message}`));
            }

            logger.info(`[IMAP] Bulk import search completed. Found ${results?.length || 0} messages`);

            if (!results || results.length === 0) {
              logger.warn('[IMAP] No emails found in date range');
              imap.end();
              return resolve([]);
            }

            // Limit results
            const uids = results.slice(0, maxEmails);
            logger.info(`[IMAP] Fetching ${uids.length} email(s) for bulk import...`);

            const fetch = imap.fetch(uids, {
              bodies: '',
              markSeen: false,
            });

            const parsePromises: Promise<void>[] = [];

            fetch.on('message', (msg) => {
              msg.on('body', (stream) => {
                const parsePromise = new Promise<void>((resolveMsg) => {
                  simpleParser(stream as any, async (err, parsed) => {
                    if (err) {
                      logger.error('[IMAP] Email parsing error:', err);
                      resolveMsg();
                      return;
                    }

                    try {
                      const message = this.parseEmail(parsed);
                      messages.push(message);
                      logger.info(`[IMAP] ✓ Parsed bulk email from: ${message.from}`);
                    } catch (error) {
                      logger.error('[IMAP] Error processing bulk email:', error);
                    }
                    resolveMsg();
                  });
                });
                parsePromises.push(parsePromise);
              });
            });

            fetch.once('error', (err) => {
              logger.error('[IMAP] Fetch error:', err);
              imap.end();
              reject(new InternalServerError(`Failed to fetch emails: ${err.message}`));
            });

            fetch.once('end', async () => {
              logger.info('[IMAP] Bulk import fetch completed, waiting for parsing...');
              await Promise.all(parsePromises);
              logger.info(`[IMAP] ✓ All bulk emails parsed. Total: ${messages.length}`);
              imap.end();
              resolve(messages);
            });
          });
        });
      });

      imap.once('error', (err: Error) => {
        logger.error('[IMAP] Connection error:', err);
        reject(new InternalServerError(`IMAP connection failed: ${err.message}`));
      });

      logger.info(`[IMAP] Connecting for bulk import to ${emailAccount.imapHost}:${emailAccount.imapPort}...`);
      imap.connect();
    });
  }

  /**
   * 🔥 Fetch ALL emails (including read) for specific senders
   * This is for comprehensive video recovery from all applicant emails
   */
  async fetchAllEmailsFromSenders(
    emailAccount: IEmailAccount,
    senderEmails: string[],
    maxEmails: number = 1000,
    sinceDate?: Date
  ): Promise<EmailMessage[]> {
    return new Promise((resolve, reject) => {
      const messages: EmailMessage[] = [];

      // Try to decrypt password, if it fails, use plain text
      let password = emailAccount.imapPassword;
      try {
        password = decrypt(emailAccount.imapPassword);
      } catch (err) {
        logger.warn('[IMAP] Password decryption failed, using plain text password');
        password = emailAccount.imapPassword;
      }

      const imap = this.createConnection({
        host: emailAccount.imapHost,
        port: emailAccount.imapPort,
        user: emailAccount.imapUser,
        password: password,
        tls: emailAccount.imapTls,
      });

      imap.once('ready', () => {
        logger.info('[IMAP] Connection ready for ALL emails fetch...');
        
        imap.openBox('INBOX', false, (err, box) => {
          if (err) {
            imap.end();
            return reject(new InternalServerError(`Failed to open inbox: ${err.message}`));
          }

          logger.info(`[IMAP] 🔥 Fetching ALL emails (read + unread). Total in inbox: ${box.messages.total}`);

          // 🔥 Build search criteria - search by sender emails
          const searchCriteria: any[] = ['ALL']; // Get ALL emails, not just UNSEEN
          
          if (sinceDate) {
            const formattedDate = sinceDate.toISOString().split('T')[0];
            searchCriteria.push(['SINCE', formattedDate]);
            logger.info(`[IMAP] 🔥 Using date filter: SINCE ${formattedDate}`);
          }

          // Search for ALL emails (with optional date filter)
          imap.search(searchCriteria, (err, results) => {
            if (err) {
              logger.error('[IMAP] Search error:', err);
              imap.end();
              return reject(new InternalServerError(`Failed to search emails: ${err.message}`));
            }

            logger.info(`[IMAP] Search completed. Found ${results?.length || 0} total messages.`);

            if (!results || results.length === 0) {
              logger.warn('[IMAP] No emails found, closing connection');
              imap.end();
              return resolve([]);
            }

            // Limit results
            const uids = results.slice(-maxEmails); // Get latest emails
            logger.info(`[IMAP] Fetching ${uids.length} email(s) to filter by sender...`);

            const fetch = imap.fetch(uids, {
              bodies: '',
              markSeen: false, // Don't mark as read
            });

            const parsePromises: Promise<void>[] = [];

            fetch.on('message', (msg) => {
              msg.on('body', (stream) => {
                const parsePromise = new Promise<void>((resolveMsg) => {
                  simpleParser(stream as any, async (err, parsed) => {
                    if (err) {
                      logger.error('[IMAP] Email parsing error:', err);
                      resolveMsg();
                      return;
                    }

                    try {
                      const message = this.parseEmail(parsed);
                      
                      // 🔥 Filter by sender email (case-insensitive)
                      const fromEmail = message.from.toLowerCase();
                      const isFromApplicant = senderEmails.some(email => 
                        fromEmail.includes(email.toLowerCase())
                      );
                      
                      if (isFromApplicant) {
                        messages.push(message);
                        logger.info(`[IMAP] ✓ Found email from applicant: ${message.from}`);
                      }
                    } catch (error) {
                      logger.error('[IMAP] Error processing email:', error);
                    }
                    resolveMsg();
                  });
                });
                parsePromises.push(parsePromise);
              });
            });

            fetch.once('error', (err) => {
              logger.error('[IMAP] Fetch error:', err);
              imap.end();
              reject(new InternalServerError(`Failed to fetch emails: ${err.message}`));
            });

            fetch.once('end', async () => {
              logger.info('[IMAP] Fetch completed, waiting for parsing...');
              await Promise.all(parsePromises);
              logger.info(`[IMAP] ✓ All emails parsed and filtered. Found ${messages.length} from applicants.`);
              imap.end();
              resolve(messages);
            });
          });
        });
      });

      imap.once('error', (err: Error) => {
        logger.error('[IMAP] Connection error:', err);
        reject(new InternalServerError(`IMAP connection failed: ${err.message}`));
      });

      logger.info(`[IMAP] Connecting to fetch emails from ${senderEmails.length} applicants...`);
      imap.connect();
    });
  }

  /**
   * Mark an email as read
   */
  async markAsRead(emailAccount: IEmailAccount, messageId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      // Try to decrypt password, if it fails, use plain text
      let password = emailAccount.imapPassword;
      try {
        password = decrypt(emailAccount.imapPassword);
      } catch (err) {
        logger.warn('[IMAP] Password decryption failed in markAsRead, using plain text password');
        password = emailAccount.imapPassword;
      }

      const imap = this.createConnection({
        host: emailAccount.imapHost,
        port: emailAccount.imapPort,
        user: emailAccount.imapUser,
        password,
        tls: emailAccount.imapTls,
      });

      imap.once('ready', () => {
        imap.openBox('INBOX', false, (err) => {
          if (err) {
            imap.end();
            return reject(err);
          }

          imap.search([['HEADER', 'MESSAGE-ID', messageId]], (err, results) => {
            if (err || !results || results.length === 0) {
              imap.end();
              return reject(err || new Error('Email not found'));
            }

            imap.addFlags(results, ['\\Seen'], (err) => {
              imap.end();
              if (err) return reject(err);
              resolve();
            });
          });
        });
      });

      imap.once('error', reject);
      imap.connect();
    });
  }

  /**
   * Test IMAP connection
   */
  async testConnection(emailAccount: IEmailAccount): Promise<boolean> {
    return new Promise((resolve) => {
      // Try to decrypt password, if it fails, use plain text
      let password = emailAccount.imapPassword;
      try {
        password = decrypt(emailAccount.imapPassword);
      } catch (err) {
        logger.warn('[IMAP] Password decryption failed in testConnection, using plain text password');
        password = emailAccount.imapPassword;
      }

      const imap = this.createConnection({
        host: emailAccount.imapHost,
        port: emailAccount.imapPort,
        user: emailAccount.imapUser,
        password,
        tls: emailAccount.imapTls,
      });

      imap.once('ready', () => {
        imap.end();
        resolve(true);
      });

      imap.once('error', () => {
        resolve(false);
      });

      setTimeout(() => {
        try {
          imap.end();
        } catch (e) {
          // Ignore
        }
        resolve(false);
      }, 10000); // 10 second timeout

      imap.connect();
    });
  }

  /**
   * Parse email object
   */
  private parseEmail(parsed: ParsedMail): EmailMessage {
    const attachments = parsed.attachments?.map(att => ({
      filename: att.filename || 'unnamed',
      content: att.content,
      contentType: att.contentType,
      size: att.size,
    })) || [];

    // Handle from and to addresses
    const fromText = parsed.from && 'text' in parsed.from ? parsed.from.text : '';
    const toText = parsed.to && 'text' in parsed.to ? parsed.to.text : '';

    // Extract reply headers
    const inReplyTo = parsed.inReplyTo || undefined;
    const references = parsed.references ? 
      (Array.isArray(parsed.references) ? parsed.references : [parsed.references]) : 
      undefined;

    return {
      from: fromText || '',
      to: toText ? [toText] : [],
      subject: parsed.subject || '',
      body: parsed.text || '',
      bodyHtml: parsed.html || undefined,
      attachments,
      date: parsed.date || new Date(),
      messageId: parsed.messageId || '',
      inReplyTo,
      references,
    };
  }
}

export default new IMAPService();
