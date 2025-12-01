import logger from './logger';

/**
 * Job Matcher Utility
 * Intelligently matches email applications to jobs based on:
 * 1. Job ID mentioned in subject/body
 * 2. Job title mentioned in subject/body
 * 3. Email received date vs job published date for same-title jobs
 */

interface Job {
  id: string;
  title: string;
  status: string;
  createdAt: Date;
  publishedAt?: Date;
}

/**
 * Extract job ID from email subject or body
 * Looks for patterns like: "Job ID: ABC123", "Job #ABC123", "Ref: ABC123", etc.
 */
export function extractJobId(subject: string, body: string): string | null {
  const combinedText = `${subject} ${body}`;
  
  // Common patterns for job ID references
  const patterns = [
    /job\s*(?:id|ref|reference|#|no|number)[\s:]*([a-zA-Z0-9]{10,})/gi,
    /(?:ref|reference)[\s:]*([a-zA-Z0-9]{10,})/gi,
    /job[\s#-]*([a-zA-Z0-9]{10,})/gi,
    /position\s*(?:id|ref)[\s:]*([a-zA-Z0-9]{10,})/gi,
  ];
  
  for (const pattern of patterns) {
    const match = combinedText.match(pattern);
    if (match && match[1]) {
      const potentialId = match[1].trim();
      // Firestore document IDs are typically 20 characters
      if (potentialId.length >= 10 && potentialId.length <= 30) {
        logger.info(`📋 Extracted job ID from email: ${potentialId}`);
        return potentialId;
      }
    }
  }
  
  return null;
}

/**
 * Extract job title from email subject or body
 * Looks for patterns like: "Application for Software Engineer", "Applying to Data Analyst position", etc.
 */
export function extractJobTitle(subject: string, body: string): string | null {
  const combinedText = `${subject} ${body}`;
  
  // Common patterns for job title references
  const patterns = [
    /application\s+(?:for|to)\s+(?:the\s+)?(?:position\s+of\s+)?(.+?)(?:\s+position|\s+role|\s+job|\s+at|\.|$)/i,
    /applying\s+(?:for|to)\s+(?:the\s+)?(?:position\s+of\s+)?(.+?)(?:\s+position|\s+role|\s+job|\s+at|\.|$)/i,
    /interested\s+in\s+(?:the\s+)?(.+?)(?:\s+position|\s+role|\s+job|\s+at|\.|$)/i,
    /(?:for|to)\s+(?:the\s+)?(?:position|role|job)\s+(?:of\s+)?(.+?)(?:\s+at|\.|$)/i,
    /position[:\s]+(.+?)(?:\s+at|\.|$)/i,
    /job\s+title[:\s]+(.+?)(?:\s+at|\.|$)/i,
    /role[:\s]+(.+?)(?:\s+at|\.|$)/i,
  ];
  
  for (const pattern of patterns) {
    const match = combinedText.match(pattern);
    if (match && match[1]) {
      let title = match[1].trim();
      // Clean up the title
      title = title.replace(/\s+/g, ' '); // Remove extra spaces
      title = title.replace(/[^\w\s-]/g, ''); // Remove special chars except hyphens
      
      // Validate length (reasonable job title length)
      if (title.length >= 3 && title.length <= 100) {
        logger.info(`📋 Extracted job title from email: "${title}"`);
        return title;
      }
    }
  }
  
  return null;
}

/**
 * Find matching job by ID
 */
export async function findJobById(
  jobId: string,
  jobService: any
): Promise<Job | null> {
  try {
    const job = await jobService.findById(jobId);
    if (job && job.status !== 'closed') {
      logger.info(`✓ Found job by ID: ${job.title} (${job.id})`);
      return job;
    }
    return null;
  } catch (error) {
    logger.error(`Error finding job by ID ${jobId}:`, error);
    return null;
  }
}

/**
 * Find matching jobs by title (case-insensitive, partial match)
 */
export async function findJobsByTitle(
  title: string,
  jobService: any
): Promise<Job[]> {
  try {
    // Get all open jobs (we can't do case-insensitive search in Firestore easily)
    const allJobs = await jobService.find([
      { field: 'status', operator: 'in', value: ['open', 'draft', 'on_hold'] }
    ]);
    
    // Filter by title (case-insensitive, partial match)
    const normalizedSearchTitle = title.toLowerCase().trim();
    const matchingJobs = allJobs.filter((job: Job) => {
      const normalizedJobTitle = job.title.toLowerCase().trim();
      // Check if titles match (exact or partial)
      return normalizedJobTitle.includes(normalizedSearchTitle) || 
             normalizedSearchTitle.includes(normalizedJobTitle) ||
             normalizedJobTitle === normalizedSearchTitle;
    });
    
    if (matchingJobs.length > 0) {
      logger.info(`✓ Found ${matchingJobs.length} job(s) matching title: "${title}"`);
    }
    
    return matchingJobs;
  } catch (error) {
    logger.error(`Error finding jobs by title "${title}":`, error);
    return [];
  }
}

/**
 * Select best matching job from multiple jobs with same title
 * Logic:
 * 1. If email received BEFORE all jobs' published dates: Use oldest job (first published)
 * 2. If email received AFTER all jobs: Use newest job (most recently published)
 * 3. If email is between dates: Use the job that was published closest before the email date
 */
export function selectBestJobMatch(
  jobs: Job[],
  emailReceivedDate: Date
): Job | null {
  if (jobs.length === 0) return null;
  if (jobs.length === 1) return jobs[0];
  
  // Sort jobs by published date (or created date if no published date)
  const sortedJobs = jobs.sort((a, b) => {
    const dateA = a.publishedAt || a.createdAt;
    const dateB = b.publishedAt || b.createdAt;
    return dateA.getTime() - dateB.getTime();
  });
  
  const oldestJob = sortedJobs[0];
  const newestJob = sortedJobs[sortedJobs.length - 1];
  
  const oldestJobDate = oldestJob.publishedAt || oldestJob.createdAt;
  const newestJobDate = newestJob.publishedAt || newestJob.createdAt;
  
  // Case 1: Email received before oldest job was published
  if (emailReceivedDate < oldestJobDate) {
    logger.info(`📅 Email received BEFORE oldest job - selecting: ${oldestJob.title} (${oldestJob.id})`);
    return oldestJob;
  }
  
  // Case 2: Email received after newest job was published
  if (emailReceivedDate >= newestJobDate) {
    logger.info(`📅 Email received AFTER newest job - selecting: ${newestJob.title} (${newestJob.id})`);
    return newestJob;
  }
  
  // Case 3: Email is between dates - find closest job before email date
  let selectedJob = oldestJob;
  for (const job of sortedJobs) {
    const jobDate = job.publishedAt || job.createdAt;
    if (jobDate <= emailReceivedDate) {
      selectedJob = job;
    } else {
      break;
    }
  }
  
  logger.info(`📅 Email received between jobs - selecting: ${selectedJob.title} (${selectedJob.id})`);
  return selectedJob;
}

/**
 * Main function: Match email to a job
 * Returns job ID if match found, null otherwise
 */
export async function matchEmailToJob(
  subject: string,
  body: string,
  emailReceivedDate: Date,
  jobService: any
): Promise<string | null> {
  logger.info('🔍 Starting job matching for email...');
  
  // Step 1: Try to find job by ID
  const jobId = extractJobId(subject, body);
  if (jobId) {
    const job = await findJobById(jobId, jobService);
    if (job) {
      logger.info(`✅ Matched to job by ID: ${job.title} (${job.id})`);
      return job.id;
    }
  }
  
  // Step 2: Try to find job by title
  const jobTitle = extractJobTitle(subject, body);
  if (jobTitle) {
    const matchingJobs = await findJobsByTitle(jobTitle, jobService);
    
    if (matchingJobs.length > 0) {
      const selectedJob = selectBestJobMatch(matchingJobs, emailReceivedDate);
      if (selectedJob) {
        logger.info(`✅ Matched to job by title: ${selectedJob.title} (${selectedJob.id})`);
        return selectedJob.id;
      }
    }
  }
  
  logger.info('❌ No job match found for email');
  return null;
}
