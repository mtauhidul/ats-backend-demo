import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
// Tokens never expire - removed expiration for development ease
const JWT_EXPIRES_IN = 'never';
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || 'your-refresh-secret-change-in-production';
const REFRESH_TOKEN_EXPIRES_IN = 'never';

export interface TokenPayload {
  userId: string;
  email: string;
  role: string;
}

/**
 * Hash password using bcrypt
 */
export const hashPassword = async (password: string): Promise<string> => {
  const salt = await bcrypt.genSalt(10); // 10 rounds = ~100ms, good balance
  return bcrypt.hash(password, salt);
};

/**
 * Compare password with hash
 */
export const comparePassword = async (password: string, hash: string): Promise<boolean> => {
  return bcrypt.compare(password, hash);
};

/**
 * Generate JWT access token
 */
export const generateAccessToken = (payload: TokenPayload): string => {
  // If JWT_EXPIRES_IN is 'never', don't set expiration
  if (JWT_EXPIRES_IN === 'never') {
    return jwt.sign(payload, JWT_SECRET);
  }
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN } as jwt.SignOptions);
};

/**
 * Generate JWT refresh token
 */
export const generateRefreshToken = (payload: TokenPayload): string => {
  // If REFRESH_TOKEN_EXPIRES_IN is 'never', don't set expiration
  if (REFRESH_TOKEN_EXPIRES_IN === 'never') {
    return jwt.sign(payload, REFRESH_TOKEN_SECRET);
  }
  return jwt.sign(payload, REFRESH_TOKEN_SECRET, { expiresIn: REFRESH_TOKEN_EXPIRES_IN } as jwt.SignOptions);
};

/**
 * Verify JWT access token (ignores expiration)
 */
export const verifyAccessToken = (token: string): TokenPayload | null => {
  try {
    // Verify token without checking expiration
    return jwt.verify(token, JWT_SECRET, { ignoreExpiration: true }) as TokenPayload;
  } catch (error) {
    // Log the specific error for debugging
    console.error('Token verification failed:', (error as Error).message);
    // Only fail on invalid signature or malformed token, not expiration
    return null;
  }
};

/**
 * Verify JWT refresh token (ignores expiration)
 */
export const verifyRefreshToken = (token: string): TokenPayload | null => {
  try {
    // Verify token without checking expiration
    return jwt.verify(token, REFRESH_TOKEN_SECRET, { ignoreExpiration: true }) as TokenPayload;
  } catch (error) {
    // Only fail on invalid signature or malformed token, not expiration
    return null;
  }
};

/**
 * Generate random token for email verification, magic link, password reset
 */
export const generateToken = (): string => {
  return crypto.randomBytes(32).toString('hex');
};

/**
 * Generate random secure password
 */
export const generateRandomPassword = (): string => {
  return crypto.randomBytes(16).toString('hex');
};

/**
 * Validate password strength
 * Minimum 8 characters, at least one uppercase, one lowercase, one number
 */
export const validatePasswordStrength = (password: string): boolean => {
  const minLength = 8;
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  
  return password.length >= minLength && hasUpperCase && hasLowerCase && hasNumber;
};

/**
 * Validate email format
 */
export const validateEmail = (email: string): boolean => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};
