import { Router } from 'express';
import {
  parseResume,
  parseAndSaveResume,
  reparseApplicationResume,
} from '../controllers/resume.controller';
import { authenticate, requireRole } from '../middleware/auth';
import { uploadResume, uploadVideo } from '../middleware/upload';
import { validate } from '../middleware/validation';
import {
  parseResumeSchema,
  parseAndSaveResumeSchema,
} from '../types/resume.types';

const router = Router();

/**
 * PUBLIC ROUTES (No Authentication Required)
 * These routes are used by the public job application flow
 */

/**
 * @route   POST /api/resumes/public/parse
 * @desc    Parse resume and return JSON (public apply workflow)
 * @access  Public
 */
router.post(
  '/public/parse',
  uploadResume,
  parseResume
);

/**
 * @route   POST /api/resumes/public/upload
 * @desc    Upload resume to Cloudinary and return URL (public apply workflow)
 * @access  Public
 */
router.post(
  '/public/upload',
  uploadResume,
  async (req: any, res: any) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, error: { message: 'No file uploaded' } });
      }

      const logger = require('../utils/logger').default;
      logger.info(`Resume upload attempt - File: ${req.file.originalname}, MIME: ${req.file.mimetype}, Size: ${req.file.size}`);

      // Check if user uploaded a video file by mistake
      const videoExtensions = ['.mp4', '.mov', '.avi', '.webm', '.mkv'];
      const fileExt = req.file.originalname.toLowerCase().match(/\.[^.]+$/)?.[0];
      
      if (fileExt && videoExtensions.includes(fileExt)) {
        logger.warn(`Video file rejected: ${req.file.originalname}`);
        return res.status(400).json({ 
          success: false, 
          error: { message: 'Video files should be uploaded using the video upload field, not the resume field' } 
        });
      }

      // Additional check: reject video MIME types
      const videoMimeTypes = ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm', 'video/x-matroska'];
      if (videoMimeTypes.includes(req.file.mimetype)) {
        logger.warn(`Video MIME type rejected: ${req.file.originalname} (${req.file.mimetype})`);
        return res.status(400).json({ 
          success: false, 
          error: { message: 'Video files should be uploaded using the video upload field, not the resume field' } 
        });
      }

      // Upload to Cloudinary
      const cloudinary = require('../services/cloudinary.service').default;
      const result = await cloudinary.uploadResume(req.file.buffer, req.file.originalname);

      logger.info(`Resume uploaded successfully: ${result.url}`);
      res.json({
        success: true,
        data: {
          url: result.url,
          publicId: result.publicId,
          originalName: req.file.originalname,
        },
      });
    } catch (error: any) {
      const logger = require('../utils/logger').default;
      logger.error(`Resume upload failed: ${error.message}`);
      
      // Provide helpful error message for format issues
      let errorMessage = error.message || 'Failed to upload resume';
      if (errorMessage.includes('file format not allowed')) {
        errorMessage = 'Invalid file format. Please upload a PDF, DOC, or DOCX document';
      }
      
      res.status(500).json({
        success: false,
        error: { message: errorMessage },
      });
    }
  }
);

/**
 * @route   POST /api/resumes/public/upload-video
 * @desc    Upload video introduction to Cloudinary and return URL (public apply workflow)
 * @access  Public
 */
router.post(
  '/public/upload-video',
  uploadVideo,
  async (req: any, res: any) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, error: { message: 'No video uploaded' } });
      }

      const logger = require('../utils/logger').default;
      logger.info(`Video upload attempt - File: ${req.file.originalname}, MIME: ${req.file.mimetype}, Size: ${(req.file.size / 1024 / 1024).toFixed(2)} MB`);

      // Upload to Cloudinary with optimized settings
      const cloudinary = require('../services/cloudinary.service').default;
      const result = await cloudinary.uploadVideo(req.file.buffer, req.file.originalname);

      logger.info(`Video uploaded successfully: ${result.url}`);
      res.json({
        success: true,
        data: {
          url: result.url,
          publicId: result.publicId,
          originalName: req.file.originalname,
          fileSize: result.bytes,
        },
      });
    } catch (error: any) {
      const logger = require('../utils/logger').default;
      logger.error(`Video upload failed: ${error.message}`);
      
      // Provide helpful error messages
      let errorMessage = error.message || 'Failed to upload video';
      if (errorMessage.includes('timeout') || errorMessage.includes('Timeout')) {
        errorMessage = 'Video upload timed out. Please try with a smaller file or check your internet connection.';
      } else if (errorMessage.includes('file format')) {
        errorMessage = 'Invalid video format. Please upload MP4, MOV, AVI, WEBM, or MKV files.';
      }
      
      res.status(500).json({
        success: false,
        error: { message: errorMessage },
      });
    }
  }
);

/**
 * AUTHENTICATED ROUTES
 * These routes require authentication
 */
router.use(authenticate);

/**
 * @route   POST /api/resumes/parse
 * @desc    Parse resume and return JSON (manual import workflow)
 * @access  Recruiter, Admin, Super Admin
 */
router.post(
  '/parse',
  requireRole('recruiter', 'admin'),
  uploadResume,
  validate(parseResumeSchema),
  parseResume
);

/**
 * @route   POST /api/resumes/upload
 * @desc    Upload resume to Cloudinary and return URL
 * @access  Recruiter, Admin, Super Admin
 */
router.post(
  '/upload',
  requireRole('recruiter', 'admin'),
  uploadResume,
  async (req: any, res: any) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, error: { message: 'No file uploaded' } });
      }

      // Upload to Cloudinary
      const cloudinary = require('../services/cloudinary.service').default;
      const result = await cloudinary.uploadResume(req.file.buffer, req.file.originalname);

      res.json({
        success: true,
        data: {
          url: result.url,
          publicId: result.publicId,
          originalName: req.file.originalname,
        },
      });
    } catch (error: any) {
      res.status(500).json({
        success: false,
        error: { message: error.message || 'Failed to upload resume' },
      });
    }
  }
);

/**
 * @route   POST /api/resumes/parse-and-save
 * @desc    Parse resume and auto-create application (direct apply workflow)
 * @access  Recruiter, Admin, Super Admin
 */
router.post(
  '/parse-and-save',
  requireRole('recruiter', 'admin'),
  uploadResume,
  validate(parseAndSaveResumeSchema),
  parseAndSaveResume
);

/**
 * @route   POST /api/resumes/reparse/:id
 * @desc    Re-parse existing application's resume
 * @access  Recruiter, Admin, Super Admin
 */
router.post(
  '/reparse/:id',
  requireRole('recruiter', 'admin'),
  reparseApplicationResume
);

export default router;
