import { v2 as cloudinary } from 'cloudinary';
import { config } from '../config';
import logger from '../utils/logger';
import { InternalServerError } from '../utils/errors';

// Configure Cloudinary
cloudinary.config({
  cloud_name: config.cloudinary.cloudName,
  api_key: config.cloudinary.apiKey,
  api_secret: config.cloudinary.apiSecret,
  timeout: 300000, // 5 minutes timeout for large uploads
});

export interface UploadResult {
  url: string;
  publicId: string;
  format: string;
  resourceType: string;
  bytes: number;
}

class CloudinaryService {
  /**
   * Upload file to Cloudinary
   */
  async uploadFile(
    fileBuffer: Buffer,
    options: {
      folder?: string;
      filename?: string;
      resourceType?: 'image' | 'raw' | 'video' | 'auto';
      allowedFormats?: string[];
    } = {}
  ): Promise<UploadResult> {
    try {
      const {
        folder = 'ats',
        filename,
        resourceType = 'auto',
        allowedFormats,
      } = options;

      return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder,
            public_id: filename,
            resource_type: resourceType,
            allowed_formats: allowedFormats,
          },
          (error, result) => {
            if (error || !result) {
              logger.error('Cloudinary upload error:', error);
              reject(new InternalServerError('File upload failed'));
            } else {
              resolve({
                url: result.secure_url,
                publicId: result.public_id,
                format: result.format,
                resourceType: result.resource_type,
                bytes: result.bytes,
              });
            }
          }
        );

        uploadStream.end(fileBuffer);
      });
    } catch (error) {
      logger.error('Cloudinary service error:', error);
      throw new InternalServerError('File upload service error');
    }
  }

  /**
   * Upload resume (PDF or DOC)
   */
  async uploadResume(
    fileBuffer: Buffer,
    filename: string
  ): Promise<UploadResult> {
    // Note: We don't use allowedFormats for 'raw' resource type
    // because Cloudinary doesn't properly recognize doc/docx formats
    // Validation is done at the multer middleware level instead
    return this.uploadFile(fileBuffer, {
      folder: 'ats/resumes',
      filename: `resume_${Date.now()}_${filename}`,
      resourceType: 'raw',
      // Remove allowedFormats - causes issues with docx files
    });
  }

  /**
   * Upload avatar image
   */
  async uploadAvatar(
    fileBuffer: Buffer,
    filename: string
  ): Promise<UploadResult> {
    return this.uploadFile(fileBuffer, {
      folder: 'ats/avatars',
      filename: `avatar_${Date.now()}_${filename}`,
      resourceType: 'image',
      allowedFormats: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
    });
  }

  /**
   * Upload company logo
   */
  async uploadLogo(
    fileBuffer: Buffer,
    filename: string
  ): Promise<UploadResult> {
    return this.uploadFile(fileBuffer, {
      folder: 'ats/logos',
      filename: `logo_${Date.now()}_${filename}`,
      resourceType: 'image',
      allowedFormats: ['jpg', 'jpeg', 'png', 'svg', 'webp'],
    });
  }

  /**
   * Sanitize filename to remove emojis and special characters
   */
  private sanitizeFilename(filename: string): string {
    // Remove emojis and special characters, keep only alphanumeric, dots, hyphens, underscores
    return filename
      .replace(/[\u{1F600}-\u{1F64F}]/gu, '') // Emoticons
      .replace(/[\u{1F300}-\u{1F5FF}]/gu, '') // Misc Symbols and Pictographs
      .replace(/[\u{1F680}-\u{1F6FF}]/gu, '') // Transport and Map
      .replace(/[\u{2600}-\u{26FF}]/gu, '')   // Misc symbols
      .replace(/[\u{2700}-\u{27BF}]/gu, '')   // Dingbats
      .replace(/[\u{FE00}-\u{FE0F}]/gu, '')   // Variation Selectors
      .replace(/[\u{1F900}-\u{1F9FF}]/gu, '') // Supplemental Symbols and Pictographs
      .replace(/[\u{1FA70}-\u{1FAFF}]/gu, '') // Symbols and Pictographs Extended-A
      .replace(/[^\w\s.-]/g, '')               // Remove remaining special chars
      .replace(/\s+/g, '_')                    // Replace spaces with underscores
      .replace(/_{2,}/g, '_')                  // Replace multiple underscores with single
      .replace(/^[._-]+|[._-]+$/g, '')         // Remove leading/trailing dots, underscores, hyphens
      .trim();
  }

  /**
   * Upload video introduction with optimized settings for large files
   */
  async uploadVideo(
    fileBuffer: Buffer,
    filename: string
  ): Promise<UploadResult> {
    try {
      const sanitizedFilename = this.sanitizeFilename(filename);
      const publicId = `video_${Date.now()}_${sanitizedFilename}`;
      
      logger.info(`Starting video upload: ${filename} (${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB)`);

      return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
          {
            folder: 'ats/videos',
            public_id: publicId,
            resource_type: 'video',
            allowed_formats: ['mp4', 'mov', 'avi', 'webm', 'mkv'],
            chunk_size: 6000000, // 6MB chunks for better reliability
            timeout: 300000, // 5 minutes timeout
          },
          (error, result) => {
            if (error || !result) {
              logger.error('Cloudinary video upload error:', error);
              reject(new InternalServerError(error?.message || 'Video upload failed'));
            } else {
              logger.info(`Video uploaded successfully: ${result.secure_url}`);
              resolve({
                url: result.secure_url,
                publicId: result.public_id,
                format: result.format,
                resourceType: result.resource_type,
                bytes: result.bytes,
              });
            }
          }
        );

        uploadStream.end(fileBuffer);
      });
    } catch (error: any) {
      logger.error('Video upload service error:', error);
      throw new InternalServerError(error?.message || 'Video upload service error');
    }
  }

  /**
   * Upload general document
   */
  async uploadDocument(
    fileBuffer: Buffer,
    filename: string
  ): Promise<UploadResult> {
    return this.uploadFile(fileBuffer, {
      folder: 'ats/documents',
      filename: `doc_${Date.now()}_${filename}`,
      resourceType: 'raw',
    });
  }

  /**
   * Delete file from Cloudinary
   */
  async deleteFile(publicId: string, resourceType: 'image' | 'raw' = 'raw'): Promise<void> {
    try {
      await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
      logger.info(`Deleted file from Cloudinary: ${publicId}`);
    } catch (error) {
      logger.error('Cloudinary delete error:', error);
      throw new InternalServerError('File deletion failed');
    }
  }

  /**
   * Get file URL from public ID
   */
  getFileUrl(publicId: string, options?: any): string {
    return cloudinary.url(publicId, options);
  }
}

export default new CloudinaryService();
