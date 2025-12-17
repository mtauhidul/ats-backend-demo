import { Request, Response } from 'express';
import { getFirestoreDB } from '../config/firebase';
import logger from '../utils/logger';
import { FieldValue } from 'firebase-admin/firestore';

const SETTINGS_COLLECTION = 'settings';
const EMAIL_SETTINGS_DOC = 'emailConfiguration';

interface EmailSettings {
  fromEmail: string;
  fromName: string;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string;
  updatedBy?: string;
}

/**
 * Get email settings (from email and from name)
 */
export const getEmailSettings = async (req: Request, res: Response) => {
  try {
    const db = getFirestoreDB();
    const settingsDoc = await db
      .collection(SETTINGS_COLLECTION)
      .doc(EMAIL_SETTINGS_DOC)
      .get();

    if (!settingsDoc.exists) {
      // Return default from env if not configured yet
      const defaultSettings: EmailSettings = {
        fromEmail: process.env.RESEND_FROM_EMAIL || '',
        fromName: process.env.RESEND_FROM_NAME || '',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      
      return res.status(200).json(defaultSettings);
    }

    const settings = settingsDoc.data() as EmailSettings;
    res.status(200).json(settings);
  } catch (error: any) {
    logger.error('Error fetching email settings:', error);
    res.status(500).json({ error: 'Failed to fetch email settings' });
  }
};

/**
 * Update email settings (from email and from name)
 */
export const updateEmailSettings = async (req: Request, res: Response) => {
  try {
    const { fromEmail, fromName } = req.body;
    const userId = (req as any).user?.userId;

    if (!fromEmail || !fromName) {
      return res.status(400).json({ 
        error: 'Both fromEmail and fromName are required' 
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(fromEmail)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const db = getFirestoreDB();
    const settingsRef = db.collection(SETTINGS_COLLECTION).doc(EMAIL_SETTINGS_DOC);
    const settingsDoc = await settingsRef.get();

    const updateData: any = {
      fromEmail,
      fromName,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: userId || 'system',
    };

    if (!settingsDoc.exists) {
      // Create new settings document
      updateData.createdAt = FieldValue.serverTimestamp();
      updateData.createdBy = userId || 'system';
      await settingsRef.set(updateData);
      logger.info('Email settings created', { fromEmail, fromName, userId });
    } else {
      // Update existing settings
      await settingsRef.update(updateData);
      logger.info('Email settings updated', { fromEmail, fromName, userId });
    }

    res.status(200).json({ 
      message: 'Email settings updated successfully',
      fromEmail,
      fromName,
    });
  } catch (error: any) {
    logger.error('Error updating email settings:', error);
    res.status(500).json({ error: 'Failed to update email settings' });
  }
};

/**
 * Helper function to get email settings (for internal use)
 */
export const getEmailSettingsInternal = async (): Promise<EmailSettings> => {
  try {
    const db = getFirestoreDB();
    const settingsDoc = await db
      .collection(SETTINGS_COLLECTION)
      .doc(EMAIL_SETTINGS_DOC)
      .get();

    if (!settingsDoc.exists) {
      // Return default from env
      return {
        fromEmail: process.env.RESEND_FROM_EMAIL || '',
        fromName: process.env.RESEND_FROM_NAME || '',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }

    return settingsDoc.data() as EmailSettings;
  } catch (error) {
    logger.error('Error fetching email settings internally:', error);
    // Fallback to env
    return {
      fromEmail: process.env.RESEND_FROM_EMAIL || '',
      fromName: process.env.RESEND_FROM_NAME || '',
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }
};
