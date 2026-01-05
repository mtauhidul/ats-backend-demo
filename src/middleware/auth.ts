import { NextFunction, Request, Response } from "express";
import { userService, IUser } from "../services/firestore";
import { AuthenticationError, AuthorizationError } from "../utils/errors";
import { verifyAccessToken, TokenPayload } from "../utils/auth";
import logger from "../utils/logger";

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: IUser & { id: string };
      userId?: string;
      tokenPayload?: TokenPayload;
    }
  }
}

/**
 * Verify JWT token and attach user to request
 */
export const authenticate = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new AuthenticationError("No token provided");
    }

    const token = authHeader.substring(7);

    // Verify JWT token
    const payload = verifyAccessToken(token);

    if (!payload) {
      logger.warn('Token verification failed', { 
        tokenPreview: token.substring(0, 20) + '...',
        authHeader: authHeader.substring(0, 30) + '...'
      });
      throw new AuthenticationError("Invalid or expired token");
    }

    // Find user in database
    const user = await userService.findById(payload.userId);

    if (!user || !user.id) {
      throw new AuthenticationError("User not found");
    }

    // Check if user is active
    if (!user.isActive) {
      throw new AuthenticationError("Your account has been deactivated");
    }

    // Attach user to request
    req.user = user as IUser & { id: string };
    req.userId = user.id;
    req.tokenPayload = payload;

    next();
  } catch (error: unknown) {
    const errorMessage = (error as Error).message || "Authentication failed";
    next(new AuthenticationError(errorMessage));
  }
};

/**
 * Require specific role(s)
 */
export const requireRole = (...allowedRoles: string[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new AuthenticationError("User not authenticated"));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(
        new AuthorizationError(
          `This action requires one of the following roles: ${allowedRoles.join(
            ", "
          )}`
        )
      );
    }

    next();
  };
};

/**
 * Require admin role
 */
export const requireAdmin = requireRole("admin");

/**
 * Permission types matching frontend
 */
type UserPermission = 
  | "canManageClients"
  | "canManageJobs"
  | "canReviewApplications"
  | "canManageCandidates"
  | "canSendEmails"
  | "canManageTeam"
  | "canAccessAnalytics";

/**
 * Check if user has specific permission (granular)
 * This checks the user's permissions object directly
 * Includes audit logging for security tracking
 */
export const requirePermission = (...requiredPermissions: UserPermission[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new AuthenticationError("User not authenticated"));
    }

    const endpoint = `${req.method} ${req.originalUrl}`;
    const userId = req.user.id;
    const userEmail = req.user.email;
    const userRole = req.user.role;

    // Admins have all permissions by default
    if (req.user.role === "admin") {
      logger.info(`[PERMISSION] Admin access granted: ${userEmail} to ${endpoint}`);
      return next();
    }

    // Check if user has permissions object
    if (!req.user.permissions) {
      logger.warn(
        `[PERMISSION] Access denied - No permissions assigned: User ${userEmail} (${userId}) tried to access ${endpoint}`
      );
      return next(
        new AuthorizationError(
          "User has no permissions assigned. Please contact your administrator."
        )
      );
    }

    // Check if user has at least one of the required permissions
    const hasRequiredPermission = requiredPermissions.some(
      (permission) => req.user?.permissions?.[permission] === true
    );

    if (!hasRequiredPermission) {
      const userPermissions = Object.entries(req.user.permissions)
        .filter(([, value]) => value === true)
        .map(([key]) => key);

      logger.warn(
        `[PERMISSION] Access denied: User ${userEmail} (${userId}, role: ${userRole}) ` +
        `tried to access ${endpoint}. Required: [${requiredPermissions.join(", ")}], ` +
        `Has: [${userPermissions.join(", ")}]`
      );

      return next(
        new AuthorizationError(
          `This action requires one of the following permissions: ${requiredPermissions.join(", ")}`
        )
      );
    }

    // Log successful permission check
    const grantedPermission = requiredPermissions.find(
      (permission) => req.user?.permissions?.[permission] === true
    );
    logger.info(
      `[PERMISSION] Access granted: User ${userEmail} (${userId}) accessed ${endpoint} ` +
      `with permission: ${grantedPermission}`
    );

    next();
  };
};

/**
 * Check if user has ALL specified permissions
 * Includes audit logging for security tracking
 */
export const requireAllPermissions = (...requiredPermissions: UserPermission[]) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new AuthenticationError("User not authenticated"));
    }

    const endpoint = `${req.method} ${req.originalUrl}`;
    const userId = req.user.id;
    const userEmail = req.user.email;
    const userRole = req.user.role;

    // Admins have all permissions by default
    if (req.user.role === "admin") {
      logger.info(`[PERMISSION] Admin access granted: ${userEmail} to ${endpoint}`);
      return next();
    }

    // Check if user has permissions object
    if (!req.user.permissions) {
      logger.warn(
        `[PERMISSION] Access denied - No permissions assigned: User ${userEmail} (${userId}) tried to access ${endpoint}`
      );
      return next(
        new AuthorizationError(
          "User has no permissions assigned. Please contact your administrator."
        )
      );
    }

    // Check if user has ALL required permissions
    const hasAllPermissions = requiredPermissions.every(
      (permission) => req.user?.permissions?.[permission] === true
    );

    if (!hasAllPermissions) {
      const missingPermissions = requiredPermissions.filter(
        (permission) => !req.user?.permissions?.[permission]
      );

      logger.warn(
        `[PERMISSION] Access denied: User ${userEmail} (${userId}, role: ${userRole}) ` +
        `tried to access ${endpoint}. Missing permissions: [${missingPermissions.join(", ")}]`
      );

      return next(
        new AuthorizationError(
          `This action requires all of the following permissions: ${requiredPermissions.join(", ")}`
        )
      );
    }

    // Log successful permission check
    logger.info(
      `[PERMISSION] Access granted: User ${userEmail} (${userId}) accessed ${endpoint} ` +
      `with all required permissions: [${requiredPermissions.join(", ")}]`
    );

    next();
  };
};

/**
 * Legacy permission check (kept for backward compatibility)
 * @deprecated Use requirePermission instead
 */
export const hasPermission = (requiredPermission: string) => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new AuthenticationError("User not authenticated"));
    }

    // Admins have all permissions
    if (req.user.role === "admin") {
      return next();
    }

    // Define role-based permissions (legacy)
    const rolePermissions: Record<string, string[]> = {
      admin: [
        "view_all",
        "create_all",
        "edit_all",
        "delete_all",
        "manage_users",
        "manage_clients",
        "manage_jobs",
        "manage_applications",
        "manage_candidates",
        "manage_interviews",
        "manage_settings",
      ],
      recruiter: [
        "view_all",
        "create_applications",
        "edit_applications",
        "create_candidates",
        "edit_candidates",
        "create_interviews",
        "edit_interviews",
        "view_jobs",
        "view_clients",
      ],
      hiring_manager: [
        "view_all",
        "edit_applications",
        "edit_candidates",
        "create_interviews",
        "edit_interviews",
        "provide_feedback",
      ],
      interviewer: [
        "view_assigned",
        "view_candidates",
        "view_interviews",
        "provide_feedback",
      ],
    };

    const userPermissions = rolePermissions[req.user.role] || [];

    if (!userPermissions.includes(requiredPermission)) {
      return next(
        new AuthorizationError(
          `You do not have the required permission: ${requiredPermission}`
        )
      );
    }

    next();
  };
};

/**
 * Optional authentication - doesn't fail if no token
 */
export const optionalAuth = async (
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      const payload = verifyAccessToken(token);

      if (payload) {
        const user = await userService.findById(payload.userId);

        if (user && user.id && user.isActive) {
          req.user = user as IUser & { id: string };
          req.userId = user.id;
          req.tokenPayload = payload;
        }
      }
    }

    next();
  } catch (error) {
    // Silently fail for optional auth
    next();
  }
};
