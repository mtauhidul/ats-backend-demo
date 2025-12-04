import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
// Support: '15m', '1h', '24h', '7d', '30d', '365d', or 'never' for no expiration
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';
const REFRESH_TOKEN_SECRET = process.env.REFRESH_TOKEN_SECRET || 'your-refresh-secret-change-in-production';
const REFRESH_TOKEN_EXPIRES_IN = process.env.REFRESH_TOKEN_EXPIRES_IN || '7d';

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
  const options: jwt.SignOptions = JWT_EXPIRES_IN === 'never' ? {} : { expiresIn: JWT_EXPIRES_IN };
  return jwt.sign(payload, JWT_SECRET, options);
};

/**
 * Generate JWT refresh token
 */
export const generateRefreshToken = (payload: TokenPayload): string => {
  // If REFRESH_TOKEN_EXPIRES_IN is 'never', don't set expiration
  const options: jwt.SignOptions = REFRESH_TOKEN_EXPIRES_IN === 'never' ? {} : { expiresIn: REFRESH_TOKEN_EXPIRES_IN };
  return jwt.sign(payload, REFRESH_TOKEN_SECRET, options);
};

/**
 * Verify JWT access token
 */
export const verifyAccessToken = (token: string): TokenPayload | null => {
  try {
    return jwt.verify(token, JWT_SECRET) as TokenPayload;
  } catch (error) {
    return null;
  }
};

/**
 * Verify JWT refresh token
 */
export const verifyRefreshToken = (token: string): TokenPayload | null => {
  try {
    return jwt.verify(token, REFRESH_TOKEN_SECRET) as TokenPayload;
  } catch (error) {
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
