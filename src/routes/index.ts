import { Router } from 'express';
import authRoutes from './auth.routes';
import emailAccountRoutes from './emailAccount.routes';
// import emailAutomationRoutes from './emailAutomation.routes'; // TODO: Reimplement with Firestore
import emailTemplateRoutes from './emailTemplate.routes';
import emailSettingsRoutes from './emailSettings.routes';
import resumeRoutes from './resume.routes';
import applicationRoutes from './application.routes';
import candidateRoutes from './candidate.routes';
import jobRoutes from './job.routes';
import clientRoutes from './client.routes';
import pipelineRoutes from './pipeline.routes';
import categoryRoutes from './category.routes';
import tagRoutes from './tag.routes';
import userRoutes from './user.routes';
import teamMemberRoutes from './teamMember.routes';
import interviewRoutes from './interview.routes';
import emailRoutes from './email.routes';
import notificationRoutes from './notification.routes';
import messageRoutes from './message.routes';
import webhookRoutes from './webhook.routes';
import activityRoutes from './activity.routes';
import settingsRoutes from './settings.routes';

const router = Router();

// API Routes
router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/team', teamMemberRoutes);
router.use('/interviews', interviewRoutes);
router.use('/emails', emailRoutes);
router.use('/email-templates', emailTemplateRoutes);
router.use('/email-settings', emailSettingsRoutes);
router.use('/notifications', notificationRoutes);
router.use('/messages', messageRoutes);
router.use('/email-accounts', emailAccountRoutes);
// router.use('/email-automation', emailAutomationRoutes); // TODO: Reimplement with Firestore
router.use('/settings', settingsRoutes);
router.use('/resumes', resumeRoutes);
router.use('/applications', applicationRoutes);
router.use('/candidates', candidateRoutes);
router.use('/jobs', jobRoutes);
router.use('/clients', clientRoutes);
router.use('/pipelines', pipelineRoutes);
router.use('/categories', categoryRoutes);
router.use('/tags', tagRoutes);
router.use('/webhooks', webhookRoutes);
router.use('/activities', activityRoutes);

// Health check
router.get('/health', (_req, res) => {
  res.json({
    status: 'success',
    message: 'ATS Backend API is running',
    timestamp: new Date().toISOString(),
  });
});

export default router;
