import { Request, Response } from "express";
import { systemSettingsService } from "../services/firestore";
import logger from "../utils/logger";

/**
 * Get IMAP settings (without password)
 */
export const getSmtpSettings = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const settings = await systemSettingsService.getSettings();

    const smtpSettings = settings.smtp
      ? {
          enabled: settings.smtp.enabled,
          host: settings.smtp.host,
          port: settings.smtp.port,
          username: settings.smtp.username,
          secure: settings.smtp.secure,
          lastChecked: settings.smtp.lastChecked,
          lastSync: settings.smtp.lastSync,
        }
      : null;

    res.json({
      success: true,
      data: smtpSettings,
    });
  } catch (error: any) {
    logger.error("Error fetching IMAP settings:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch IMAP settings",
      error: error.message,
    });
  }
};

/**
 * Update SMTP settings
 */
export const updateSmtpSettings = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { enabled, host, port, username, password, secure } = req.body;

    // Validate required fields when enabling
    if (enabled) {
      if (!host || !port || !username || !password) {
        res.status(400).json({
          success: false,
          message: "Host, port, username, and password are required when enabling IMAP",
        });
        return;
      }
    }

    await systemSettingsService.updateSmtpSettings(
      {
        enabled,
        host,
        port: parseInt(port),
        username,
        password,
        secure,
      }
    );

    // Fetch updated settings
    const updatedSettings = await systemSettingsService.getSettings();
    const smtpSettings = updatedSettings.smtp
      ? {
          enabled: updatedSettings.smtp.enabled,
          host: updatedSettings.smtp.host,
          port: updatedSettings.smtp.port,
          username: updatedSettings.smtp.username,
          secure: updatedSettings.smtp.secure,
          lastChecked: updatedSettings.smtp.lastChecked,
          lastSync: updatedSettings.smtp.lastSync,
        }
      : null;

    res.json({
      success: true,
      message: "IMAP settings updated successfully",
      data: smtpSettings,
    });
  } catch (error: any) {
    logger.error("Error updating IMAP settings:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update IMAP settings",
      error: error.message,
    });
  }
};

/**
 * Test IMAP connection
 */
export const testSmtpConnection = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { host, port, username, password, secure } = req.body;

    if (!host || !port || !username || !password) {
      res.status(400).json({
        success: false,
        message: "Host, port, username, and password are required",
      });
      return;
    }

    // Import IMAP client
    const Imap = require("imap");

    // Create IMAP connection config
    const config = {
      user: username,
      password: password,
      host: host,
      port: parseInt(port),
      tls: secure,
      tlsOptions: { rejectUnauthorized: false },
      connTimeout: 10000, // 10 seconds timeout
      authTimeout: 10000,
    };

    // Test connection
    const imap = new Imap(config);

    await new Promise((resolve, reject) => {
      let connectionResolved = false;

      imap.once("ready", () => {
        if (!connectionResolved) {
          connectionResolved = true;
          imap.end();
          resolve(true);
        }
      });

      imap.once("error", (err: Error) => {
        if (!connectionResolved) {
          connectionResolved = true;
          reject(err);
        }
      });

      imap.once("end", () => {
        if (!connectionResolved) {
          connectionResolved = true;
          resolve(true);
        }
      });

      imap.connect();

      // Timeout fallback
      setTimeout(() => {
        if (!connectionResolved) {
          connectionResolved = true;
          imap.end();
          reject(new Error("Connection timeout"));
        }
      }, 12000);
    });

    res.json({
      success: true,
      message: "IMAP connection successful",
    });
  } catch (error: any) {
    logger.error("Error testing IMAP connection:", error);
    res.status(500).json({
      success: false,
      message: "Failed to connect to IMAP server",
      error: error.message,
    });
  }
};

/**
 * Manually trigger email sync
 */
export const syncInboundEmails = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const settings = await systemSettingsService.getSettings();

    if (!settings.smtp?.enabled) {
      res.status(400).json({
        success: false,
        message: "IMAP is not enabled. Please configure and enable IMAP settings first.",
      });
      return;
    }

    // Email sync functionality would go here
    // For now, return a success message
    res.json({
      success: true,
      message: "Email sync feature is not yet implemented",
      data: {
        synced: 0,
        processed: 0
      },
    });
  } catch (error: any) {
    logger.error("Error syncing emails:", error);
    res.status(500).json({
      success: false,
      message: "Failed to sync emails",
      error: error.message,
    });
  }
};

/**
 * Update existing inbound emails to link them to jobs
 * This is a one-time migration endpoint
 */
export const updateInboundEmailLinks = async (
  _req: Request,
  res: Response
): Promise<void> => {
  try {
    const { Email } = require("../models/Email");
    const { Candidate } = require("../models/Candidate");
    const { Application } = require("../models/Application");

    // Get all inbound emails without jobId
    const emails = await Email.find({
      direction: "inbound",
      candidateId: { $exists: true },
      jobId: { $exists: false },
    });

    logger.info(`Found ${emails.length} inbound emails without job links`);
    
    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const email of emails) {
      try {
        const candidate = await Candidate.findById(email.candidateId);

        if (candidate) {
          // Find the most recent application
          const latestApplication = await Application.findOne({
            candidateId: candidate._id,
          })
            .sort({ createdAt: -1 })
            .populate("jobId");

          if (latestApplication) {
            email.applicationId = latestApplication._id;
            email.jobId =
              latestApplication.jobId?._id || latestApplication.jobId;

            await email.save();
            updated++;
            console.log(
              `✓ Updated email ${email._id} - linked to job ${email.jobId}`
            );
          } else {
            skipped++;
            console.log(
              `⚠ Email ${email._id} - no application found for candidate`
            );
          }
        }
      } catch (error: any) {
        logger.error(`✗ Error updating email ${email._id}:`, error);
        errors.push(`Email ${email._id}: ${error.message}`);
      }
    }

    res.json({
      success: true,
      message: "Email links update completed",
      data: {
        total: emails.length,
        updated,
        skipped,
        errors,
      },
    });
  } catch (error: any) {
    logger.error("Error updating email links:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update email links",
      error: error.message,
    });
  }
};
