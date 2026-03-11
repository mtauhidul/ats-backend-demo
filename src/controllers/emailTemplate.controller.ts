import { Request, Response } from 'express';
import { emailTemplateService } from '../services/firestore';
import logger from '../utils/logger';

/**
 * Extract variables from template body
 * Finds all {{variableName}} patterns
 */
const extractVariables = (text: string): string[] => {
  const regex = /\{\{(\w+)\}\}/g;
  const variables: string[] = [];
  let match;
  
  while ((match = regex.exec(text)) !== null) {
    if (!variables.includes(match[1])) {
      variables.push(match[1]);
    }
  }
  
  return variables;
};

/**
 * Get all email templates
 * Supports filtering by type, isDefault, isActive
 * GET /api/email-templates?type=interview&isDefault=true&isActive=true
 */
export const getEmailTemplates = async (req: Request, res: Response): Promise<void> => {
  try {
    const { type, isDefault, isActive } = req.query;
    
    // Fetch all templates
    const allTemplates = await emailTemplateService.find([]);
    
    // Apply filters in memory
    const templates = allTemplates.filter((t: any) => {
      if (type && t.type !== type) return false;
      if (isDefault !== undefined && t.isDefault !== (isDefault === 'true')) return false;
      if (isActive !== undefined) {
        if (t.isActive !== (isActive === 'true')) return false;
      } else {
        // By default, only show active templates
        if (t.isActive !== true) return false;
      }
      return true;
    }).sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
    res.json({
      success: true,
      data: templates,
      count: templates.length
    });
  } catch (error: any) {
    logger.error('Error fetching email templates:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch email templates',
      error: error.message
    });
  }
};

/**
 * Get email template by ID
 * GET /api/email-templates/:id
 */
export const getEmailTemplateById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    
    const template = await emailTemplateService.findById(id);
    
    if (!template) {
      res.status(404).json({
        success: false,
        message: 'Email template not found'
      });
      return;
    }
    
    res.json({
      success: true,
      data: template
    });
  } catch (error: any) {
    logger.error('Error fetching email template:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch email template',
      error: error.message
    });
  }
};

/**
 * Get templates by type
 * GET /api/email-templates/type/:type
 */
export const getTemplatesByType = async (req: Request, res: Response): Promise<void> => {
  try {
    const { type } = req.params;
    
    const allTemplates = await emailTemplateService.find([]);
    const templates = allTemplates
      .filter((t: any) => t.type === type && t.isActive === true)
      .sort((a: any, b: any) => {
        // Sort by isDefault first (true first), then by createdAt descending
        if (a.isDefault !== b.isDefault) return b.isDefault ? 1 : -1;
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      });
    
    res.json({
      success: true,
      data: templates,
      count: templates.length
    });
  } catch (error: any) {
    logger.error('Error fetching templates by type:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch templates by type',
      error: error.message
    });
  }
};

/**
 * Create new email template
 * POST /api/email-templates
 */
export const createEmailTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, subject, body, type, isDefault = false } = req.body;
    
    // Validate required fields
    if (!name || !subject || !body || !type) {
      res.status(400).json({
        success: false,
        message: 'Name, subject, body, and type are required'
      });
      return;
    }
    
    // Extract variables from body
    const variables = extractVariables(body);
    
    // Create template
    const templateId = await emailTemplateService.create({
      name,
      subject,
      body,
      type,
      variables,
      isDefault,
      isActive: true,
      createdBy: req.user?.id
    } as any);
    
    const template = await emailTemplateService.findById(templateId);
    
    res.status(201).json({
      success: true,
      message: 'Email template created successfully',
      data: template
    });
  } catch (error: any) {
    logger.error('Error creating email template:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create email template',
      error: error.message
    });
  }
};

/**
 * Update email template
 * PUT /api/email-templates/:id
 */
export const updateEmailTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, subject, body, type, isDefault, isActive } = req.body;
    
    const template = await emailTemplateService.findById(id);
    
    if (!template) {
      res.status(404).json({
        success: false,
        message: 'Email template not found'
      });
      return;
    }
    
    // Build updates object
    const updates: any = {};
    if (name !== undefined) updates.name = name;
    if (subject !== undefined) updates.subject = subject;
    if (type !== undefined) updates.type = type;
    if (isDefault !== undefined) updates.isDefault = isDefault;
    if (isActive !== undefined) updates.isActive = isActive;
    
    if (body !== undefined) {
      updates.body = body;
      // Re-extract variables when body changes
      updates.variables = extractVariables(body);
    }
    
    await emailTemplateService.update(id, updates);
    const updatedTemplate = await emailTemplateService.findById(id);
    
    res.json({
      success: true,
      message: 'Email template updated successfully',
      data: updatedTemplate
    });
  } catch (error: any) {
    logger.error('Error updating email template:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update email template',
      error: error.message
    });
  }
};

/**
 * Delete email template (soft delete)
 * DELETE /api/email-templates/:id
 */
export const deleteEmailTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    
    const template = await emailTemplateService.findById(id);
    
    if (!template) {
      res.status(404).json({
        success: false,
        message: 'Email template not found'
      });
      return;
    }
    
    // Soft delete - set isActive to false
    await emailTemplateService.update(id, { isActive: false });
    
    res.json({
      success: true,
      message: 'Email template deleted successfully'
    });
  } catch (error: any) {
    logger.error('Error deleting email template:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete email template',
      error: error.message
    });
  }
};

/**
 * Duplicate email template
 * POST /api/email-templates/:id/duplicate
 */
export const duplicateEmailTemplate = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    
    const originalTemplate = await emailTemplateService.findById(id);
    
    if (!originalTemplate) {
      res.status(404).json({
        success: false,
        message: 'Email template not found'
      });
      return;
    }
    
    // Create duplicate with modified name
    const duplicateId = await emailTemplateService.create({
      name: `${originalTemplate.name} (Copy)`,
      subject: originalTemplate.subject,
      body: originalTemplate.body,
      type: originalTemplate.type,
      variables: originalTemplate.variables,
      isDefault: false, // Duplicates are never default
      isActive: true,
      createdBy: req.user?.id
    } as any);
    
    const duplicate = await emailTemplateService.findById(duplicateId);
    
    res.status(201).json({
      success: true,
      message: 'Email template duplicated successfully',
      data: duplicate
    });
  } catch (error: any) {
    logger.error('Error duplicating email template:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to duplicate email template',
      error: error.message
    });
  }
};

/**
 * Get default templates (for seeding/initialization)
 * GET /api/email-templates/defaults
 */
export const getDefaultTemplates = async (_req: Request, res: Response): Promise<void> => {
  try {
    const allTemplates = await emailTemplateService.find([]);
    const templates = allTemplates
      .filter((t: any) => t.isDefault === true && t.isActive === true)
      .sort((a: any, b: any) => a.type.localeCompare(b.type));
    
    res.json({
      success: true,
      data: templates,
      count: templates.length
    });
  } catch (error: any) {
    logger.error('Error fetching default templates:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch default templates',
      error: error.message
    });
  }
};
