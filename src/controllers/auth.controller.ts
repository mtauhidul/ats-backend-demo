import { Request, Response } from 'express';
import { userService, IUser } from '../services/firestore';
import { asyncHandler, successResponse } from '../utils/helpers';
import { BadRequestError, AuthenticationError, NotFoundError } from '../utils/errors';
import {
  hashPassword,
  comparePassword,
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  generateToken,
  generateRandomPassword,
  validatePasswordStrength,
  validateEmail,
  TokenPayload,
} from '../utils/auth';
import { sendInvitationEmail, sendMagicLinkEmail, sendPasswordResetEmail, sendTeamMemberUpdateEmail } from '../services/email.service';
import { logActivity } from '../services/activity.service';
import logger from '../utils/logger';

/**
 * Register new user (Admin only - creates user and sends invitation)
 */
export const register = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { email, firstName, lastName, role, department, title, phone, permissions } = req.body;

    // Validate required fields
    if (!email || !firstName || !lastName) {
      throw new BadRequestError('Email, first name, and last name are required');
    }

    // Validate email format
    if (!validateEmail(email)) {
      throw new BadRequestError('Invalid email format');
    }

    // Check if user already exists
    const existingUser = await userService.findByEmail(email.toLowerCase());
    if (existingUser) {
      throw new BadRequestError('User with this email already exists');
    }

    // Generate random password and email verification token
    const randomPassword = generateRandomPassword();
    const passwordHash = await hashPassword(randomPassword);
    const emailVerificationToken = generateToken();
    const emailVerificationExpires = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

    // Set default permissions based on role
    const userRole = role || 'recruiter';
    const defaultPermissions = userRole === 'admin' ? {
      canManageClients: true,
      canManageJobs: true,
      canReviewApplications: true,
      canManageCandidates: true,
      canSendEmails: true,
      canManageTeam: true,
      canAccessAnalytics: true,
    } : {
      canManageClients: false,
      canManageJobs: false,
      canReviewApplications: true,
      canManageCandidates: userRole === 'recruiter',
      canSendEmails: true,
      canManageTeam: false,
      canAccessAnalytics: false,
    };

    // Use custom permissions if provided, otherwise use defaults
    const userPermissions = permissions ? { ...defaultPermissions, ...permissions } : defaultPermissions;

    // Create user
    const userId = await userService.create({
      email: email.toLowerCase(),
      firstName,
      lastName,
      passwordHash,
      role: userRole,
      department,
      title,
      phone,
      emailVerified: false,
      emailVerificationToken,
      emailVerificationExpires,
      isActive: true,
      permissions: userPermissions,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const user = await userService.findById(userId);
    if (!user) {
      throw new Error('Failed to create user');
    }

    logger.info(`New user registered: ${user.email} by ${req.user?.email}`);

    // Send invitation email with email verification link
    const emailSent = await sendInvitationEmail(user.email, user.firstName, emailVerificationToken);
    
    if (!emailSent) {
      logger.warn(`Failed to send invitation email to ${user.email}`);
    }

    successResponse(
      res,
      {
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          department: user.department,
          title: user.title,
          phone: user.phone,
          avatar: user.avatar,
          emailVerified: user.emailVerified,
          isActive: user.isActive,
          permissions: user.permissions,
        },
        message: emailSent ? 'Invitation email sent to user' : 'User created but email failed to send',
      },
      'User registered successfully',
      201
    );
  }
);

/**
 * Register first admin user (public - only works if no users exist)
 */
export const registerFirstAdmin = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { email, firstName, lastName, password } = req.body;

    // Check if any users exist
    const userCount = await userService.count();
    if (userCount > 0) {
      throw new BadRequestError('Admin user already exists. Please contact your administrator.');
    }

    // Validate required fields
    if (!email || !firstName || !lastName || !password) {
      throw new BadRequestError('Email, first name, last name, and password are required');
    }

    // Validate email format
    if (!validateEmail(email)) {
      throw new BadRequestError('Invalid email format');
    }

    // Validate password strength (min 8 chars)
    if (password.length < 8) {
      throw new BadRequestError('Password must be at least 8 characters long');
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Admin gets all permissions by default
    const adminPermissions = {
      canManageClients: true,
      canManageJobs: true,
      canReviewApplications: true,
      canManageCandidates: true,
      canSendEmails: true,
      canManageTeam: true,
      canAccessAnalytics: true,
    };

    // Create first admin user (auto-verified)
    const adminId = await userService.create({
      email: email.toLowerCase(),
      firstName,
      lastName,
      passwordHash,
      role: 'admin',
      isActive: true,
      emailVerified: true, // Auto-verify first admin
      permissions: adminPermissions,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const admin = await userService.findById(adminId);
    if (!admin) {
      throw new Error('Failed to create admin');
    }

    // Generate tokens
    const accessToken = generateAccessToken({
      userId: admin.id!,
      email: admin.email,
      role: admin.role,
    });

    const refreshToken = generateRefreshToken({
      userId: admin.id!,
      email: admin.email,
      role: admin.role,
    });

    // Save refresh token
    await userService.updateRefreshToken(admin.id!, refreshToken);

    logger.info('First admin user created', { userId: admin.id, email: admin.email });

    successResponse(
      res,
      {
        user: {
          id: admin.id,
          email: admin.email,
          firstName: admin.firstName,
          lastName: admin.lastName,
          role: admin.role,
          isActive: admin.isActive,
          emailVerified: admin.emailVerified,
        },
        accessToken,
        refreshToken,
      },
      'First admin user created successfully',
      201
    );
  }
);

/**
 * Login with email and password
 */
export const login = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { email, password } = req.body;

    // Validate required fields
    if (!email || !password) {
      throw new BadRequestError('Email and password are required');
    }

    logger.info(`Login attempt for email: ${email.toLowerCase()}`);

    // Find user with password hash (explicitly select it)
    const user = await userService.findByEmail(email.toLowerCase());
    
    if (!user) {
      logger.warn(`User not found for email: ${email.toLowerCase()}`);
      throw new AuthenticationError('Invalid email or password');
    }

    logger.info(`User found: ${user.id}, isActive: ${user.isActive}, emailVerified: ${user.emailVerified}, hasPassword: ${!!user.passwordHash}`);

    // Check if user is active
    if (!user.isActive) {
      logger.warn(`User account is deactivated: ${user.email}`);
      throw new AuthenticationError('Your account has been deactivated. Please contact an administrator.');
    }

    // Verify password
    const isPasswordValid = await comparePassword(password, user.passwordHash);
    logger.info(`Password validation result: ${isPasswordValid}`);
    if (!isPasswordValid) {
      logger.warn(`Invalid password for user: ${user.email}`);
      throw new AuthenticationError('Invalid email or password');
    }

    // Check if email is verified
    if (!user.emailVerified) {
      logger.warn(`Email not verified for user: ${user.email}`);
      throw new AuthenticationError('Please verify your email before logging in');
    }

    // Generate tokens
    const payload: TokenPayload = {
      userId: user.id!,
      email: user.email,
      role: user.role,
    };

    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);

    // Save refresh token to user
    await userService.update(user.id!, {
      refreshToken,
      lastLogin: new Date(),
    });

    // Log activity (fire-and-forget to not block login)
    logActivity({
      userId: user.id!,
      action: 'login',
      metadata: { method: 'password' }
    }).catch(err => logger.error('Failed to log login activity:', err));

    logger.info(`User logged in: ${user.email}`);

    // Set refresh token as HTTP-only cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    successResponse(res, {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        department: user.department,
        title: user.title,
        phone: user.phone,
        avatar: user.avatar,
        emailVerified: user.emailVerified,
        isActive: user.isActive,
        permissions: user.permissions,
        lastLogin: new Date(),
      },
      accessToken,
    }, 'Login successful');
  }
);

/**
 * Request magic link (passwordless login)
 */
export const requestMagicLink = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { email } = req.body;

    // Validate email
    if (!email || !validateEmail(email)) {
      throw new BadRequestError('Valid email is required');
    }

    // Find user
    const user = await userService.findByEmail(email.toLowerCase());
    
    if (!user) {
      // Don't reveal if user exists or not for security
      successResponse(res, {}, 'If an account exists, a magic link has been sent to your email');
      return;
    }

    // Check if user is active
    if (!user.isActive) {
      throw new AuthenticationError('Your account has been deactivated');
    }

    // Generate magic link token
    const magicLinkToken = generateToken();
    const magicLinkExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await userService.setMagicLinkToken(user.id!, magicLinkToken, magicLinkExpires);

    logger.info(`Magic link requested for: ${user.email}`);

    // Send magic link email
    const emailSent = await sendMagicLinkEmail(user.email, user.firstName, magicLinkToken);
    
    if (!emailSent) {
      logger.warn(`Failed to send magic link email to ${user.email}`);
    }

    successResponse(res, {}, 'If an account exists, a magic link has been sent to your email');
  }
);

/**
 * Verify magic link and login
 */
export const verifyMagicLink = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { token } = req.params;

    if (!token) {
      throw new BadRequestError('Token is required');
    }

    // Find user with valid magic link token
    const users = await userService.find([
      { field: 'magicLinkToken', operator: '==', value: token },
    ]);
    
    const user = users.find(u => u.magicLinkExpires && u.magicLinkExpires > new Date());

    if (!user) {
      throw new AuthenticationError('Invalid or expired magic link');
    }

    // Check if user is active
    if (!user.isActive) {
      throw new AuthenticationError('Your account has been deactivated');
    }

    // Clear magic link token and update user
    await userService.update(user.id!, {
      magicLinkToken: undefined,
      magicLinkExpires: undefined,
      emailVerified: true,
      lastLogin: new Date(),
    });

    // Generate tokens
    const payload: TokenPayload = {
      userId: user.id!,
      email: user.email,
      role: user.role,
    };

    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);

    // Save refresh token to user
    await userService.updateRefreshToken(user.id!, refreshToken);

    logger.info(`User logged in via magic link: ${user.email}`);

    // Set refresh token as HTTP-only cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    successResponse(res, {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        department: user.department,
        title: user.title,
        phone: user.phone,
        avatar: user.avatar,
        emailVerified: true,
        isActive: user.isActive,
        permissions: user.permissions,
      },
      accessToken,
    }, 'Login successful');
  }
);

/**
 * Verify email with token
 */
export const verifyEmail = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { token } = req.params;

    if (!token) {
      throw new BadRequestError('Token is required');
    }

    // Find user with valid email verification token
    const users = await userService.find([
      { field: 'emailVerificationToken', operator: '==', value: token },
    ]);
    
    const user = users.find(u => u.emailVerificationExpires && u.emailVerificationExpires > new Date());

    if (!user) {
      throw new BadRequestError('Invalid or expired verification token');
    }

    // Mark email as verified but DON'T clear the token yet
    // Token will be cleared when user sets their password
    await userService.verifyEmail(user.id!);

    logger.info(`Email verified for: ${user.email}`);

    // Generate tokens for auto-login
    const payload: TokenPayload = {
      userId: user.id!,
      email: user.email,
      role: user.role,
    };

    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);

    await userService.update(user.id!, {
      refreshToken,
      lastLogin: new Date(),
    });

    // Set refresh token as HTTP-only cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    successResponse(res, {
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        department: user.department,
        title: user.title,
        phone: user.phone,
        avatar: user.avatar,
        emailVerified: true,
        isActive: user.isActive,
        permissions: user.permissions,
      },
      accessToken,
    }, 'Email verified successfully');
  }
);

/**
 * Set password after email verification (for new users)
 */
export const setPassword = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { token, password } = req.body;

    if (!token || !password) {
      throw new BadRequestError('Token and password are required');
    }

    // Validate password strength
    if (!validatePasswordStrength(password)) {
      throw new BadRequestError(
        'Password must be at least 8 characters with uppercase, lowercase, and number'
      );
    }

    // Find user with valid email verification token
    const users = await userService.find([
      { field: 'emailVerificationToken', operator: '==', value: token },
    ]);
    
    const user = users.find(u => u.emailVerificationExpires && u.emailVerificationExpires > new Date());

    if (!user) {
      throw new BadRequestError('Invalid or expired verification token');
    }

    // Hash and set new password
    const passwordHash = await hashPassword(password);
    await userService.update(user.id!, {
      passwordHash,
      emailVerified: true,
      emailVerificationToken: undefined,
      emailVerificationExpires: undefined,
    });

    logger.info(`Password set for: ${user.email}`);

    successResponse(res, {}, 'Password set successfully. You can now login.');
  }
);

/**
 * Request password reset
 */
export const forgotPassword = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { email } = req.body;

    if (!email || !validateEmail(email)) {
      throw new BadRequestError('Valid email is required');
    }

    // Find user
    const user = await userService.findByEmail(email.toLowerCase());
    
    if (!user) {
      // Don't reveal if user exists or not for security
      successResponse(res, {}, 'If an account exists, a password reset link has been sent to your email');
      return;
    }

    // Generate password reset token
    const passwordResetToken = generateToken();
    const passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await userService.update(user.id!, {
      passwordResetToken,
      passwordResetExpires,
    });

    logger.info(`Password reset requested for: ${user.email}`);

    // Send password reset email
    const emailSent = await sendPasswordResetEmail(user.email, user.firstName, passwordResetToken);
    
    if (!emailSent) {
      logger.warn(`Failed to send password reset email to ${user.email}`);
    }

    successResponse(res, {}, 'If an account exists, a password reset link has been sent to your email');
  }
);

/**
 * Reset password with token
 */
export const resetPassword = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { token, password } = req.body;

    if (!token || !password) {
      throw new BadRequestError('Token and password are required');
    }

    // Validate password strength
    if (!validatePasswordStrength(password)) {
      throw new BadRequestError(
        'Password must be at least 8 characters with uppercase, lowercase, and number'
      );
    }

    // Find user with valid password reset token
    const users = await userService.find([
      { field: 'passwordResetToken', operator: '==', value: token },
    ]);
    
    const user = users.find(u => u.passwordResetExpires && u.passwordResetExpires > new Date());

    if (!user) {
      throw new BadRequestError('Invalid or expired reset token');
    }

    // Hash and set new password
    const passwordHash = await hashPassword(password);
    await userService.updatePassword(user.id!, passwordHash);

    logger.info(`Password reset for: ${user.email}`);

    successResponse(res, {}, 'Password reset successfully. You can now login.');
  }
);

/**
 * Refresh access token using refresh token
 */
export const refreshAccessToken = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const refreshToken = req.cookies.refreshToken || req.body.refreshToken;

    if (!refreshToken) {
      throw new AuthenticationError('Refresh token is required');
    }

    // Verify refresh token
    const payload = verifyRefreshToken(refreshToken);
    if (!payload) {
      throw new AuthenticationError('Invalid or expired refresh token');
    }

    // Find user and verify refresh token matches
    const user = await userService.findById(payload.userId);
    if (!user || user.refreshToken !== refreshToken) {
      throw new AuthenticationError('Invalid refresh token');
    }

    // Check if user is active
    if (!user.isActive) {
      throw new AuthenticationError('Your account has been deactivated');
    }

    // Generate new tokens
    const newPayload: TokenPayload = {
      userId: user.id!,
      email: user.email,
      role: user.role,
    };

    const newAccessToken = generateAccessToken(newPayload);
    const newRefreshToken = generateRefreshToken(newPayload);

    // Update refresh token
    await userService.updateRefreshToken(user.id!, newRefreshToken);

    // Set new refresh token cookie
    res.cookie('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    });

    successResponse(res, {
      accessToken: newAccessToken,
    }, 'Token refreshed successfully');
  }
);

/**
 * Logout user (clear refresh token)
 */
export const logout = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;

    if (userId) {
      // Clear refresh token from database
      await userService.update(userId, { refreshToken: undefined });
      logger.info(`User logged out: ${req.user?.email}`);
    }

    // Clear refresh token cookie
    res.clearCookie('refreshToken');

    successResponse(res, {}, 'Logout successful');
  }
);

/**
 * Get current user
 */
export const getMe = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;

    if (!userId) {
      throw new AuthenticationError('Not authenticated');
    }

    const user = await userService.findById(userId);

    if (!user) {
      throw new NotFoundError('User not found');
    }

    successResponse(res, {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      department: user.department,
      title: user.title,
      phone: user.phone,
      avatar: user.avatar,
      emailVerified: user.emailVerified,
      isActive: user.isActive,
      permissions: user.permissions,
      lastLogin: user.lastLogin,
      createdAt: user.createdAt,
    }, 'User retrieved successfully');
  }
);

/**
 * Update current user profile
 */
export const updateProfile = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;

    if (!userId) {
      throw new AuthenticationError('Not authenticated');
    }

    const { firstName, lastName, phone, title, department, avatar } = req.body;

    const user = await userService.findById(userId);

    if (!user) {
      throw new NotFoundError('User not found');
    }

    // Track changes for notification
    const changes: string[] = [];
    const updates: Partial<IUser> = {};
    
    // Update allowed fields
    if (firstName && firstName !== user.firstName) {
      updates.firstName = firstName;
      changes.push('First name updated');
    }
    if (lastName && lastName !== user.lastName) {
      updates.lastName = lastName;
      changes.push('Last name updated');
    }
    if (phone !== undefined && phone !== user.phone) {
      updates.phone = phone;
      changes.push('Phone number updated');
    }
    if (title !== undefined && title !== user.title) {
      updates.title = title;
      changes.push('Job title updated');
    }
    if (department !== undefined && department !== user.department) {
      updates.department = department;
      changes.push('Department updated');
    }
    // Avatar should only be updated through the dedicated upload endpoint
    // Do not accept avatar data in profile updates to avoid Firestore size limits
    if (avatar !== undefined && avatar !== user.avatar) {
      // Only allow avatar URL updates (not raw data)
      if (typeof avatar === 'string' && (avatar.startsWith('http://') || avatar.startsWith('https://') || avatar === '')) {
        updates.avatar = avatar;
        changes.push('Profile picture updated');
      } else {
        throw new BadRequestError('Avatar must be uploaded through the avatar upload endpoint (POST /api/users/:id/avatar)');
      }
    }

    // Update user if there are changes
    if (Object.keys(updates).length > 0) {
      await userService.update(userId, updates);
    }

    logger.info('User profile updated', { userId });

    // Send notification email if there were changes
    if (changes.length > 0 && user.email) {
      try {
        await sendTeamMemberUpdateEmail(
          user.email,
          user.firstName,
          changes,
          'You (self-update)'
        );
        logger.info(`Profile update notification email sent to ${user.email}`);
      } catch (emailError) {
        // Log error but don't fail the request
        logger.error(`Failed to send profile update email to ${user.email}:`, emailError);
      }
    }

    successResponse(res, {
      id: user.id,
      email: user.email,
      firstName: updates.firstName || user.firstName,
      lastName: updates.lastName || user.lastName,
      role: user.role,
      department: updates.department !== undefined ? updates.department : user.department,
      title: updates.title !== undefined ? updates.title : user.title,
      phone: updates.phone !== undefined ? updates.phone : user.phone,
      avatar: updates.avatar !== undefined ? updates.avatar : user.avatar,
      emailVerified: user.emailVerified,
      isActive: user.isActive,
      permissions: user.permissions,
    }, 'Profile updated successfully');
  }
);

/**
 * Update current user password
 */
export const updatePassword = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user?.id;

    if (!userId) {
      throw new AuthenticationError('Not authenticated');
    }

    if (!currentPassword || !newPassword) {
      throw new BadRequestError('Current password and new password are required');
    }

    // Validate new password strength
    if (!validatePasswordStrength(newPassword)) {
      throw new BadRequestError(
        'Password must be at least 8 characters with uppercase, lowercase, and number'
      );
    }

    // Find user with password hash
    const user = await userService.findById(userId);
    
    if (!user || !user.passwordHash) {
      throw new NotFoundError('User not found');
    }

    // Verify current password
    const isPasswordValid = await comparePassword(currentPassword, user.passwordHash);
    if (!isPasswordValid) {
      throw new AuthenticationError('Current password is incorrect');
    }

    // Hash and set new password
    const passwordHash = await hashPassword(newPassword);
    await userService.updatePassword(userId, passwordHash);

    logger.info(`Password updated for: ${user.email}`);

    successResponse(res, {}, 'Password updated successfully');
  }
);
