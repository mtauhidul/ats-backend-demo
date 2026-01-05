import { FirestoreBaseService } from "./base.service";

export interface IApplication {
  id?: string;
  jobId?: string;
  clientId?: string;

  // Candidate Info
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;

  // Resume & Documents
  resumeUrl: string;
  resumeOriginalName: string;
  resumeRawText?: string;
  videoIntroUrl?: string;
  coverLetter?: string;
  additionalDocuments?: Array<{
    url: string;
    originalName: string;
    type: string;
  }>;

  // Parsed Resume Data (from AI)
  parsedData?: {
    summary?: string;
    skills?: string[];
    experience?: Array<{
      company: string;
      title: string;
      duration: string;
      description?: string;
    }>;
    education?: Array<{
      institution: string;
      degree: string;
      field?: string;
      year?: string;
    }>;
    certifications?: string[];
    languages?: string[];
  };

  // AI Resume Validation
  isValidResume?: boolean;
  validationScore?: number;
  validationReason?: string;

  // AI Check Status (for email automation)
  aiCheckStatus?: "pending" | "completed" | "failed";
  aiCheckCompletedAt?: Date;

  // Candidate Details (extracted or calculated)
  yearsOfExperience?: number;
  currentTitle?: string;
  currentCompany?: string;

  // Application Details
  status: "pending" | "reviewing" | "shortlisted" | "rejected" | "approved";
  source: "manual" | "direct_apply" | "email_automation";
  sourceEmail?: string;
  sourceEmailAccountId?: string;
  sourceMessageId?: string; // Email message ID for deduplication
  rawEmailBody?: string; // Raw text body of email if applied via email
  rawEmailBodyHtml?: string; // Raw HTML body of email if applied via email
  emailSubject?: string; // Email subject if applied via email
  candidateId?: string; // Reference to candidate if converted

  // Pipeline
  pipelineStageId?: string;

  // Notes & Communication
  notes?: string;
  internalNotes?: string;

  // Timestamps
  appliedAt: Date;
  reviewedAt?: Date;
  approvedAt?: Date;
  rejectedAt?: Date;

  // Assignment
  assignedTo?: string;
  reviewedBy?: string;
  teamMembers?: string[];

  // Metadata
  createdBy?: string;
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

class ApplicationService extends FirestoreBaseService<IApplication> {
  constructor() {
    super("applications");
  }

  /**
   * Find applications by job ID
   */
  async findByJobId(jobId: string): Promise<IApplication[]> {
    return this.find([{ field: "jobId", operator: "==", value: jobId }]);
  }

  /**
   * Find applications by email
   */
  async findByEmail(email: string): Promise<IApplication[]> {
    return this.find([
      { field: "email", operator: "==", value: email.toLowerCase() },
    ]);
  }

  /**
   * Find applications by status
   */
  async findByStatus(
    status: IApplication["status"]
  ): Promise<IApplication[]> {
    return this.find([{ field: "status", operator: "==", value: status }]);
  }

  /**
   * Find applications by client ID
   */
  async findByClientId(clientId: string): Promise<IApplication[]> {
    return this.find([{ field: "clientId", operator: "==", value: clientId }]);
  }

  /**
   * Find applications assigned to a user
   */
  async findAssignedTo(userId: string): Promise<IApplication[]> {
    return this.find([{ field: "assignedTo", operator: "==", value: userId }]);
  }

  /**
   * Update application status
   */
  async updateStatus(
    id: string,
    status: IApplication["status"],
    updatedBy?: string
  ): Promise<void> {
    const updates: Partial<IApplication> = {
      status,
      updatedAt: new Date(),
      updatedBy,
    };

    // Add timestamp based on status
    if (status === "reviewing") {
      updates.reviewedAt = new Date();
    } else if (status === "approved") {
      updates.approvedAt = new Date();
    } else if (status === "rejected") {
      updates.rejectedAt = new Date();
    }

    await this.update(id, updates);
  }

  /**
   * Assign application to user
   */
  async assignTo(
    id: string,
    userId: string,
    updatedBy?: string
  ): Promise<void> {
    await this.update(id, {
      assignedTo: userId,
      updatedAt: new Date(),
      updatedBy,
    });
  }

  /**
   * Check if application exists for email and job
   */
  async existsForEmailAndJob(
    email: string,
    jobId: string
  ): Promise<boolean> {
    const results = await this.find([
      { field: "email", operator: "==", value: email.toLowerCase() },
      { field: "jobId", operator: "==", value: jobId },
    ]);
    return results.length > 0;
  }

  /**
   * Find recent applications (last N days)
   */
  async findRecent(days: number = 30): Promise<IApplication[]> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    return this.find([
      { field: "appliedAt", operator: ">=", value: cutoffDate },
    ]);
  }

  /**
   * Subscribe to applications for a specific job
   */
  subscribeToJobApplications(
    jobId: string,
    callback: (applications: IApplication[]) => void,
    options?: { limit?: number }
  ): () => void {
    return this.subscribeToCollection(
      [{ field: "jobId", operator: "==", value: jobId }],
      callback,
      options
    );
  }
}

export const applicationService = new ApplicationService();
