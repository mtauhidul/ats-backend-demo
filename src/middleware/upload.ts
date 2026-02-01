import { Request, RequestHandler } from 'express'
import multer from 'multer'
import path from 'path'
import { ValidationError } from '../utils/errors'

// Configure multer for memory storage
const storage = multer.memoryStorage()

// File filter to allow only specific file types
const fileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  const allowedTypes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ]

  const allowedExtensions = ['.pdf', '.doc', '.docx']
  const videoExtensions = ['.mp4', '.mov', '.avi', '.webm', '.mkv']
  const fileExtension = path.extname(file.originalname).toLowerCase()

  // Explicitly reject video files
  if (videoExtensions.includes(fileExtension)) {
    cb(
      new ValidationError(
        'Video files are not allowed in resume upload. Please use the video upload field.'
      )
    )
    return
  }

  if (
    allowedTypes.includes(file.mimetype) &&
    allowedExtensions.includes(fileExtension)
  ) {
    cb(null, true)
  } else {
    cb(
      new ValidationError(
        'Invalid file type. Only PDF, DOC, and DOCX files are allowed.'
      )
    )
  }
}

// Create multer upload instance
export const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
  },
  fileFilter,
})

// Middleware for single resume upload
export const uploadResume: RequestHandler = upload.single('resume')

// Middleware for multiple resume uploads
export const uploadMultipleResumes: RequestHandler = upload.array('resumes', 10) // Max 10 files

// File filter for video uploads
const videoFileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  const allowedVideoTypes = [
    'video/mp4',
    'video/quicktime', // .mov
    'video/x-msvideo', // .avi
    'video/webm',
    'video/x-matroska', // .mkv
  ]

  const allowedVideoExtensions = ['.mp4', '.mov', '.avi', '.webm', '.mkv']
  const fileExtension = path.extname(file.originalname).toLowerCase()

  if (
    allowedVideoTypes.includes(file.mimetype) &&
    allowedVideoExtensions.includes(fileExtension)
  ) {
    cb(null, true)
  } else {
    cb(
      new ValidationError(
        'Invalid file type. Only MP4, MOV, AVI, WEBM, and MKV video files are allowed.'
      )
    )
  }
}

// Create multer upload instance for videos
export const videoUpload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB max file size for videos
  },
  fileFilter: videoFileFilter,
})

// Middleware for single video upload
export const uploadVideo: RequestHandler = videoUpload.single('video')

// File filter for image uploads (avatars, logos)
const imageFileFilter = (
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  const allowedImageTypes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
  ]

  const allowedImageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp']
  const fileExtension = path.extname(file.originalname).toLowerCase()

  if (
    allowedImageTypes.includes(file.mimetype) &&
    allowedImageExtensions.includes(fileExtension)
  ) {
    cb(null, true)
  } else {
    cb(
      new ValidationError(
        'Invalid file type. Only JPG, PNG, GIF, and WEBP image files are allowed.'
      )
    )
  }
}

// Create multer upload instance for images
export const imageUpload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max file size for images
  },
  fileFilter: imageFileFilter,
})

// Middleware for single avatar/image upload
export const uploadAvatar: RequestHandler = imageUpload.single('avatar')
export const uploadLogo: RequestHandler = imageUpload.single('logo')
