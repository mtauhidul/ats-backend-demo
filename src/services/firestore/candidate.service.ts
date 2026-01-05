import { FirestoreBaseService, QueryFilter } from './base.service';
import logger from '../../utils/logger';

export interface FirestoreCandidateData {
  // Personal Info
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  location?: string;
  avatar?: string;

  // Professional Info
  currentTitle?: string;
  currentCompany?: string;
  yearsOfExperience?: number;
  linkedinUrl?: string;
  portfolioUrl?: string;

  // Resume & Documents
  resumeUrl: string;
  resumeOriginalName: string;

  // Source tracking
  source?: 'manual' | 'direct_apply' | 'email_automation' | 'email';
  rawEmailBody?: string; // Raw text body of email if applied via email
  rawEmailBodyHtml?: string; // Raw HTML body of email if applied via email
  emailSubject?: string; // Email subject if applied via email

  // Company association
  companyId: string;

  // Job Applications
  jobIds: string[];
  applicationIds: string[];
  jobApplications?: Array<{
    jobId: string;
    applicationId?: string;
    status: string;
    appliedAt: Date;
    lastStatusChange: Date;
    currentStage?: string;
    resumeScore?: number;
    emailIds: string[];
    emailsSent: number;
    emailsReceived: number;
  }>;

  // Pipeline tracking
  currentPipelineStageId?: string;
  
  // Status
  status: 'active' | 'interviewing' | 'offered' | 'hired' | 'rejected' | 'withdrawn';
  currentStage?: string;

  // Metadata
  createdAt?: Date;
  updatedAt?: Date;
  createdBy?: string;
}

/**
 * Candidate Firestore Service
 * Handles all candidate-related Firestore operations
 */
export class CandidateFirestoreService extends FirestoreBaseService<FirestoreCandidateData> {
  constructor() {
    super('candidates');
  }

  /**
   * Find candidate by email
   */
  async findByEmail(email: string): Promise<(FirestoreCandidateData & { id: string }) | null> {
    try {
      const filters: QueryFilter[] = [{ field: 'email', operator: '==', value: email.toLowerCase() }];
      return await this.findOne(filters);
    } catch (error) {
      logger.error('Error finding candidate by email:', error);
      throw error;
    }
  }

  /**
   * Find candidates by job ID
   */
  async findByJobId(jobId: string): Promise<(FirestoreCandidateData & { id: string })[]> {
    try {
      const filters: QueryFilter[] = [{ field: 'jobIds', operator: 'array-contains', value: jobId }];
      return await this.find(filters);
    } catch (error) {
      logger.error('Error finding candidates by job ID:', error);
      throw error;
    }
  }

  /**
   * Find candidates by status
   */
  async findByStatus(status: string): Promise<(FirestoreCandidateData & { id: string })[]> {
    try {
      const filters: QueryFilter[] = [{ field: 'status', operator: '==', value: status }];
      return await this.find(filters, {
        orderBy: [{ field: 'updatedAt', direction: 'desc' }],
      });
    } catch (error) {
      logger.error('Error finding candidates by status:', error);
      throw error;
    }
  }

  /**
   * Find candidates by stage
   */
  async findByStage(stage: string): Promise<(FirestoreCandidateData & { id: string })[]> {
    try {
      const filters: QueryFilter[] = [{ field: 'currentStage', operator: '==', value: stage }];
      return await this.find(filters, {
        orderBy: [{ field: 'updatedAt', direction: 'desc' }],
      });
    } catch (error) {
      logger.error('Error finding candidates by stage:', error);
      throw error;
    }
  }

  /**
   * Update candidate stage
   */
  async updateStage(candidateId: string, stage: string): Promise<void> {
    try {
      await this.update(candidateId, {
        currentStage: stage,
      } as Partial<FirestoreCandidateData>);
      logger.info(`Updated candidate ${candidateId} stage to ${stage}`);
    } catch (error) {
      logger.error('Error updating candidate stage:', error);
      throw error;
    }
  }

  /**
   * Update candidate status
   */
  async updateStatus(
    candidateId: string,
    status: 'active' | 'interviewing' | 'offered' | 'hired' | 'rejected' | 'withdrawn'
  ): Promise<void> {
    try {
      await this.update(candidateId, {
        status,
      } as Partial<FirestoreCandidateData>);
      logger.info(`Updated candidate ${candidateId} status to ${status}`);
    } catch (error) {
      logger.error('Error updating candidate status:', error);
      throw error;
    }
  }

  /**
   * Add job to candidate's jobIds
   */
  async addJobToCandidate(candidateId: string, jobId: string): Promise<void> {
    try {
      const candidate = await this.findById(candidateId);
      if (!candidate) {
        throw new Error('Candidate not found');
      }

      const jobIds = candidate.jobIds || [];
      if (!jobIds.includes(jobId)) {
        jobIds.push(jobId);
        await this.update(candidateId, {
          jobIds,
        } as Partial<FirestoreCandidateData>);
      }
    } catch (error) {
      logger.error('Error adding job to candidate:', error);
      throw error;
    }
  }

  /**
   * Search candidates by name or email
   */
  async search(query: string): Promise<(FirestoreCandidateData & { id: string })[]> {
    try {
      // Firestore doesn't support full-text search natively
      // This is a simple implementation - consider using Algolia or Elasticsearch for production
      const lowerQuery = query.toLowerCase();

      // Search by email
      const emailResults = await this.find([
        { field: 'email', operator: '>=', value: lowerQuery },
        { field: 'email', operator: '<=', value: lowerQuery + '\uf8ff' },
      ]);

      // Note: For production, implement proper full-text search with:
      // 1. Algolia integration
      // 2. Cloud Functions to sync data
      // 3. Frontend search UI with Algolia SDK

      return emailResults;
    } catch (error) {
      logger.error('Error searching candidates:', error);
      throw error;
    }
  }

  /**
   * Get candidates with pagination
   */
  async getPaginated(
    page: number = 1,
    limit: number = 20
  ): Promise<{
    candidates: (FirestoreCandidateData & { id: string })[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    try {
      const offset = (page - 1) * limit;

      const candidates = await this.findAll({
        limit,
        offset,
        orderBy: [{ field: 'createdAt', direction: 'desc' }],
      });

      const total = await this.count();
      const totalPages = Math.ceil(total / limit);

      return {
        candidates,
        total,
        page,
        totalPages,
      };
    } catch (error) {
      logger.error('Error getting paginated candidates:', error);
      throw error;
    }
  }

  /**
   * Get candidate statistics
   */
  async getStatistics(): Promise<{
    total: number;
    byStatus: Record<string, number>;
  }> {
    try {
      const total = await this.count();

      // Get counts by status
      const statuses = ['active', 'interviewing', 'offered', 'hired', 'rejected', 'withdrawn'];
      const byStatus: Record<string, number> = {};

      await Promise.all(
        statuses.map(async (status) => {
          const count = await this.count([{ field: 'status', operator: '==', value: status }]);
          byStatus[status] = count;
        })
      );

      return { total, byStatus };
    } catch (error) {
      logger.error('Error getting candidate statistics:', error);
      throw error;
    }
  }
}

// Export singleton instance with default company ID
export const candidateService = new CandidateFirestoreService();

// Export type alias for consistency
export type ICandidate = FirestoreCandidateData;
