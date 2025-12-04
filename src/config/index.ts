import dotenv from "dotenv";

dotenv.config();

export const config = {
  // Server
  env: process.env.NODE_ENV || "development",
  port: parseInt(process.env.PORT || "5000", 10),
  apiVersion: process.env.API_VERSION || "v1",

  // Database - Firestore (MongoDB removed)
  // No database URI needed - Firebase Admin SDK uses service account

  // Clerk Authentication
  clerk: {
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY || "",
    secretKey: process.env.CLERK_SECRET_KEY || "",
    jwtKey: process.env.CLERK_JWT_KEY || "",
  },

  // Frontend
  frontendUrl: process.env.FRONTEND_URL || "http://localhost:5173",

  // Cloudinary
  cloudinary: {
    cloudName: process.env.CLOUDINARY_CLOUD_NAME || "",
    apiKey: process.env.CLOUDINARY_API_KEY || "",
    apiSecret: process.env.CLOUDINARY_API_SECRET || "",
  },

  // OpenAI
  openai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    scoringModel: process.env.OPENAI_SCORING_MODEL || "gpt-4o",
  },

  // Adobe PDF Services (Fallback for PDF text extraction)
  adobe: {
    clientId: process.env.ADOBE_CLIENT_ID || "",
    clientSecret: process.env.ADOBE_CLIENT_SECRET || "",
  },

  // Zoom
  zoom: {
    accountId: process.env.ZOOM_ACCOUNT_ID || "",
    clientId: process.env.ZOOM_CLIENT_ID || "",
    clientSecret: process.env.ZOOM_CLIENT_SECRET || "",
  },

  // Resend (Outbound emails)
  resend: {
    apiKey: process.env.RESEND_API_KEY || "",
    fromEmail: process.env.RESEND_FROM_EMAIL || "resume@aristagroups.com",
    fromName: process.env.RESEND_FROM_NAME || "Arista Groups",
  },

  // System Email (Inbound - Fixed)
  systemEmail: {
    host: process.env.SYSTEM_EMAIL_HOST || "mail.aristagroups.com",
    port: parseInt(process.env.SYSTEM_EMAIL_PORT || "993", 10),
    user: process.env.SYSTEM_EMAIL_USER || "resume@aristagroups.com",
    password: process.env.SYSTEM_EMAIL_PASSWORD || "",
    tls: process.env.SYSTEM_EMAIL_TLS === "true",
  },

  // Email Automation
  email: {
    checkInterval: process.env.EMAIL_CHECK_INTERVAL || "*/15 * * * *", // Every 15 minutes
    maxFetch: parseInt(process.env.EMAIL_MAX_FETCH || "50", 10),
  },

  // Security
  jwt: {
    secret: process.env.JWT_SECRET || "your_jwt_secret_change_in_production",
  },
  encryption: {
    key: process.env.ENCRYPTION_KEY || "",
    iv: process.env.ENCRYPTION_IV || "",
  },

  // Rate Limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW || "15", 10) * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX || "1000", 10), // Increased from 100 to 1000
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || "info",
    file: process.env.LOG_FILE || "logs/app.log",
  },

  // File Uploads
  uploads: {
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE || "10485760", 10),
    allowedTypes: (process.env.ALLOWED_FILE_TYPES || "pdf,doc,docx").split(","),
  },

  // Firebase / Firestore
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID || "",
    serviceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "",
    serviceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "",
  },

  // Migration settings - DEPRECATED: We removed MongoDB completely
  // Keeping this temporarily for backward compatibility, but not used
  migration: {
    dualWriteEnabled: false, // Always false - MongoDB removed
    useFirestoreReads: true, // Always true - only Firestore now
    defaultCompanyId: process.env.DEFAULT_COMPANY_ID || "default-company",
  },
};

// Validation
export function validateConfig() {
  const required = [
    "FIREBASE_PROJECT_ID",
    "OPENAI_API_KEY",
    "RESEND_API_KEY"
  ];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }

  // Validate Firebase service account path or JSON
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_PATH && !process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    throw new Error(
      "Missing required Firebase configuration: Either FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON must be provided"
    );
  }
}
