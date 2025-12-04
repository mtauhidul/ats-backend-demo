import OpenAI from 'openai';
import { config } from '../config';
import logger from '../utils/logger';
import { InternalServerError } from '../utils/errors';
import pdf from 'pdf-parse';
import mammoth from 'mammoth';

const openai = new OpenAI({
  apiKey: config.openai.apiKey,
});

export interface ParsedResume {
  personalInfo?: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    location?: string;
    linkedin?: string;
    website?: string;
  };
  currentTitle?: string;
  currentCompany?: string;
  yearsOfExperience?: number;
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
  extractedText: string;
}

export interface AIScore {
  overallScore: number;
  skillsMatch: number;
  experienceMatch: number;
  educationMatch: number;
  summary: string;
  strengths: string[];
  concerns: string[];
  recommendation: 'strong_fit' | 'good_fit' | 'moderate_fit' | 'poor_fit';
}

export interface ResumeValidation {
  isValid: boolean;
  score: number; // 0-100
  reason: string;
  issues?: string[];
}

class OpenAIService {
  /**
   * Extract text from PDF buffer
   */
  async extractTextFromPDF(buffer: Buffer): Promise<string> {
    try {
      const data = await pdf(buffer);
      return data.text;
    } catch (error) {
      logger.error('PDF extraction error:', error);
      throw new InternalServerError('Failed to extract text from PDF');
    }
  }

  /**
   * Extract text from DOCX buffer
   */
  async extractTextFromDOCX(buffer: Buffer): Promise<string> {
    try {
      const result = await mammoth.extractRawText({ buffer });
      return result.value;
    } catch (error) {
      logger.error('DOCX extraction error:', error);
      throw new InternalServerError('Failed to extract text from DOCX');
    }
  }

  /**
   * Extract text from resume file
   */
  async extractTextFromResume(buffer: Buffer, fileType: string): Promise<string> {
    const lowerType = fileType.toLowerCase();

    if (lowerType === 'pdf' || lowerType === 'application/pdf') {
      return this.extractTextFromPDF(buffer);
    } else if (lowerType === 'docx' || lowerType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      return this.extractTextFromDOCX(buffer);
    } else if (lowerType === 'doc' || lowerType === 'application/msword') {
      return this.extractTextFromDOCX(buffer);
    } else {
      throw new InternalServerError('Unsupported file type for text extraction');
    }
  }

  /**
   * Parse resume using AI with enhanced configuration
   * Based on OLD backend's proven pattern with low temperature and JSON enforcement
   */
  async parseResume(resumeText: string, maxRetries: number = 3): Promise<ParsedResume> {
    let lastError: Error | undefined;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        logger.info(`🤖 Parsing resume with OpenAI (attempt ${attempt}/${maxRetries})`);
        
        const prompt = `
You are an expert ATS resume parser. Extract ALL relevant information from this resume and return as JSON.

RESUME TEXT:
${resumeText}

CRITICAL EXTRACTION RULES:

1. PERSONAL INFO (MANDATORY):
   - Extract first name and last name (clean up ALL CAPS, weird spacing like "MMOOINNNUURR" → "Moinur")
   - For names with multiple parts (e.g., "MIR TAUHIDUL ISLAM"):
     * firstName = First part only (e.g., "Mir")
     * lastName = Last part only (e.g., "Islam")
     * Middle names are NOT included in firstName or lastName
   - Example: "JOHN MICHAEL SMITH" → firstName: "John", lastName: "Smith"
   - Example: "MIR TAUHIDUL ISLAM" → firstName: "Mir", lastName: "Islam"
   - Find email (pattern: contains @)
   - Find phone (any format: +880-xxx, 09xxx, etc.)
   - Extract full address if present
   - Find LinkedIn URL (even if just username after "LinkedIn:")
   - Find portfolio/website URL

2. SKILLS (VERY IMPORTANT - DON'T MISS ANY):
   - Look in sections: SKILLS, TECHNICAL SKILLS, TOOLS, SOFTWARE, COMPETENCIES
   - Skills can be:
     * Pipe-separated: "R | Python | SQL"
     * Comma-separated: "R, Python, SQL"
     * Listed with bullets
     * In "Language and Software:" sections
   - Extract EVERY SINGLE skill mentioned
   - Include programming languages, software, tools, technical skills
   - Examples: R, Python, SQL, SPSS, STATA, Excel, LaTeX, Kobo Toolbox, etc.

3. CURRENT POSITION (derive from most recent work):
   - currentTitle: Most recent job title
   - currentCompany: Most recent company name
   - Calculate yearsOfExperience by counting total work duration

4. WORK EXPERIENCE (extract ALL positions):
   - Look for sections: WORK EXPERIENCE, EMPLOYMENT, RESEARCH EXPERIENCE, etc.
   - For EACH position extract:
     * Company name
     * Job title
     * Duration (standardize dates: "Apr 2025 - Present", "Feb 2024 - Feb 2025")
     * Key responsibilities (bullet points)
   - Don't skip research positions, internships, or assistant roles

5. EDUCATION (extract ALL degrees):
   - Look for: Bachelor, Master, PhD, HSC, SSC, High School, etc.
   - Extract:
     * Institution name
     * Degree name
     * Field of study
     * Year or date range
     * GPA/CGPA if mentioned

6. ADDITIONAL INFO:
   - Certifications: workshops, trainings, courses
   - Languages: spoken languages (English, Bengali, etc.)
   - Summary: extract objective/summary statement if present

DATE FORMATS TO HANDLE:
- "Feb 2024 – Feb 2025"
- "Apr 2025 – Present"
- "March2023uptoJuly2024"
- "2018-2024"
- Standardize ALL to: "Month Year - Month Year" or "Month Year - Present"

RETURN THIS EXACT JSON STRUCTURE:
{
  "personalInfo": {
    "firstName": "First name (cleaned)",
    "lastName": "Last name (cleaned)",
    "email": "email@domain.com",
    "phone": "Full phone with country code",
    "location": "Full address or City, Country",
    "linkedin": "LinkedIn URL or username",
    "website": "Portfolio/personal website URL"
  },
  "currentTitle": "Most recent job title",
  "currentCompany": "Most recent company",
  "yearsOfExperience": 2,
  "summary": "Professional summary or objective",
  "skills": [
    "Skill1",
    "Skill2",
    "Skill3"
  ],
  "experience": [
    {
      "company": "Company Name",
      "title": "Job Title",
      "duration": "Month Year - Month Year",
      "description": "Key responsibilities and achievements"
    }
  ],
  "education": [
    {
      "institution": "University Name",
      "degree": "Degree Name (e.g., Master of Science, Bachelor)",
      "field": "Field of Study",
      "year": "Year or date range"
    }
  ],
  "certifications": ["Certification1", "Workshop1"],
  "languages": ["Language1", "Language2"]
}

IMPORTANT:
- Extract EVERY skill (don't miss technical skills, software, tools)
- Extract EVERY work experience (including research assistant, internships)
- Extract EVERY education degree
- Return ONLY valid JSON, no markdown code blocks, no extra text
`.trim();

        const response = await openai.chat.completions.create({
          model: config.openai.model,
          messages: [
            {
              role: 'system',
              content: 'You are an expert resume parser with 10+ years experience analyzing resumes in all formats. Extract EVERY piece of information, handle unusual formatting, parse all date formats, and be thorough. Always return valid JSON only, no markdown code blocks.',
            },
            {
              role: 'user',
              content: prompt,
            },
          ],
          // Enhanced configuration from OLD backend
          temperature: 0.1, // Very low for consistency
          top_p: 0.1,
          frequency_penalty: 0.1,
          presence_penalty: 0.1,
          max_tokens: 3000,
          response_format: { type: 'json_object' }, // Force JSON output
        });

        const content = response.choices[0]?.message?.content;
        if (!content) {
          throw new Error('No response from OpenAI');
        }

        // Clean the response - remove markdown code blocks if present
        let cleanedContent = content.trim();

        // Remove markdown JSON code blocks like ```json ... ```
        if (cleanedContent.startsWith('```')) {
          cleanedContent = cleanedContent
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/, '')
            .replace(/\s*```$/, '');
        }

        // Parse JSON response
        const parsed = JSON.parse(cleanedContent);

        // Ensure all required fields exist and add derived fields
        const result: ParsedResume = {
          personalInfo: parsed.personalInfo || {},
          currentTitle: parsed.currentTitle || parsed.experience?.[0]?.title || '',
          currentCompany: parsed.currentCompany || parsed.experience?.[0]?.company || '',
          yearsOfExperience: parsed.yearsOfExperience || 0,
          summary: parsed.summary || '',
          skills: Array.isArray(parsed.skills) ? parsed.skills : [],
          experience: Array.isArray(parsed.experience) ? parsed.experience : [],
          education: Array.isArray(parsed.education) ? parsed.education : [],
          certifications: Array.isArray(parsed.certifications) ? parsed.certifications : [],
          languages: Array.isArray(parsed.languages) ? parsed.languages : [],
          extractedText: resumeText,
        };
        
        logger.info(`✅ Successfully parsed resume (attempt ${attempt})`);
        return result;
        
      } catch (error: any) {
        lastError = error;
        logger.error(`❌ Resume parsing attempt ${attempt} failed:`, error.message);
        
        if (attempt < maxRetries) {
          // Wait before retrying (exponential backoff)
          const waitTime = Math.pow(2, attempt) * 1000;
          logger.info(`⏳ Waiting ${waitTime}ms before retry...`);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }
    
    // All retries failed
    logger.error(`❌ All ${maxRetries} parsing attempts failed`);
    const errorMessage = lastError?.message || 'Unknown error occurred during parsing';
    throw new InternalServerError(`Failed to parse resume after ${maxRetries} attempts: ${errorMessage}`);
  }

  /**
   * Score candidate against job requirements
   */
  async scoreCandidate(
    resumeData: ParsedResume,
    jobDescription: string,
    jobRequirements: string[]
  ): Promise<AIScore> {
    try {
      const prompt = `
You are an expert recruitment AI. Analyze how well this candidate matches the job requirements.

Job Description:
${jobDescription}

Job Requirements:
${jobRequirements.join('\n')}

Candidate Resume Summary:
${resumeData.summary || 'N/A'}

Skills: ${resumeData.skills?.join(', ') || 'N/A'}

Experience:
${resumeData.experience?.map(exp => `${exp.title} at ${exp.company} (${exp.duration})`).join('\n') || 'N/A'}

Education:
${resumeData.education?.map(edu => `${edu.degree} in ${edu.field} from ${edu.institution}`).join('\n') || 'N/A'}

Please provide a detailed scoring analysis in JSON format:
{
  "overallScore": 0-100,
  "skillsMatch": 0-100,
  "experienceMatch": 0-100,
  "educationMatch": 0-100,
  "summary": "Brief summary of the analysis",
  "strengths": ["strength1", "strength2", "strength3"],
  "concerns": ["concern1", "concern2"],
  "recommendation": "strong_fit" | "good_fit" | "moderate_fit" | "poor_fit"
}

Consider:
- How many required skills the candidate has
- Relevance of work experience
- Education level and field
- Overall fit for the role

Return ONLY valid JSON, no additional text.
`.trim();

      const response = await openai.chat.completions.create({
        model: config.openai.scoringModel,
        messages: [
          {
            role: 'system',
            content: 'You are an expert recruitment AI that scores candidates against job requirements. Always return valid JSON only.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.5,
        max_tokens: 1500,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from OpenAI');
      }

      // Remove markdown code blocks if present (```json ... ```)
      let jsonContent = content.trim();
      if (jsonContent.startsWith('```')) {
        // Remove opening ```json or ```
        jsonContent = jsonContent.replace(/^```(?:json)?\s*\n/, '');
        // Remove closing ```
        jsonContent = jsonContent.replace(/\n```\s*$/, '');
        jsonContent = jsonContent.trim();
      }

      // Parse JSON response
      const score: AIScore = JSON.parse(jsonContent);

      // Validate scores are in range
      score.overallScore = Math.max(0, Math.min(100, score.overallScore));
      score.skillsMatch = Math.max(0, Math.min(100, score.skillsMatch));
      score.experienceMatch = Math.max(0, Math.min(100, score.experienceMatch));
      score.educationMatch = Math.max(0, Math.min(100, score.educationMatch));

      return score;
    } catch (error: any) {
      logger.error('Candidate scoring error:', error);
      throw new InternalServerError(`Failed to score candidate: ${error.message}`);
    }
  }

  /**
   * Validate if uploaded file is a legitimate resume
   * Detects scam resumes, invalid files, empty content, etc.
   */
  async validateResume(resumeText: string): Promise<ResumeValidation> {
    try {
      // Basic validation - check if text is too short
      if (!resumeText || resumeText.trim().length < 50) {
        return {
          isValid: false,
          score: 0,
          reason: 'Resume appears to be empty or contains insufficient content',
          issues: ['Empty or very short content (less than 50 characters)'],
        };
      }

      const prompt = `
You are an expert ATS resume validator. Your job is to determine if the provided text is a LEGITIMATE PROFESSIONAL RESUME or an INVALID/SCAM submission.

RESUME TEXT TO VALIDATE:
${resumeText}

VALIDATION CRITERIA:

1. LEGITIMATE RESUME INDICATORS (look for most of these):
   ✓ Contains personal information (name, email, phone, or location)
   ✓ Has work experience section with company names and job titles
   ✓ Lists skills, technical abilities, or competencies
   ✓ Includes education history (degrees, universities, schools)
   ✓ Professional formatting and structure
   ✓ Coherent sentences and professional language
   ✓ Dates and timelines for experience/education
   ✓ Actual content describing work or achievements

2. INVALID/SCAM RESUME INDICATORS (red flags):
   ✗ Completely empty or just a few random words
   ✗ Garbled text, nonsense characters, or corrupted content
   ✗ Just a URL, phone number, or social media link with no context
   ✗ Spam content, advertisements, or promotional material
   ✗ Wrong file type content (images, code, random data)
   ✗ Single sentence or paragraph with no professional information
   ✗ No identifiable sections (experience, education, skills)
   ✗ Obvious placeholder text like "Lorem ipsum" or "test test test"
   ✗ Inappropriate content or completely unrelated to a resume

SCORING GUIDELINES:
- 80-100: Excellent professional resume with all key sections
- 60-79: Good resume, may be missing minor details but clearly legitimate
- 40-59: Questionable - very sparse or poorly formatted but has some resume elements
- 20-39: Likely invalid - missing most resume components
- 0-19: Definitely invalid/scam - no legitimate resume content

RETURN THIS EXACT JSON STRUCTURE:
{
  "isValid": true or false,
  "score": 0-100,
  "reason": "Brief explanation of why this is valid or invalid",
  "issues": ["List specific problems found"] or null if valid
}

EXAMPLES:

VALID RESUME EXAMPLE:
{
  "isValid": true,
  "score": 85,
  "reason": "Complete professional resume with clear experience, education, and skills sections",
  "issues": null
}

INVALID RESUME EXAMPLE:
{
  "isValid": false,
  "score": 15,
  "reason": "File contains only random characters and no professional resume content",
  "issues": ["No personal information", "No work experience", "Corrupted or garbled text", "No coherent sentences"]
}

Now validate the resume provided above and return ONLY the JSON response:`;

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content: 'You are an expert resume validator for an ATS system. Analyze resumes and detect invalid or scam submissions. Always return valid JSON.',
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0.3,
        max_tokens: 500,
      });

      const content = completion.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from OpenAI');
      }

      // Extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        logger.error('Failed to parse validation response:', content);
        throw new Error('Invalid JSON response from OpenAI');
      }

      const validation: ResumeValidation = JSON.parse(jsonMatch[0]);
      
      logger.info(`Resume validation completed: ${validation.isValid ? 'VALID' : 'INVALID'} (score: ${validation.score})`);
      
      return validation;
    } catch (error: any) {
      logger.error('Resume validation error:', error);
      // Return a safe default on error - assume valid to avoid false rejections
      return {
        isValid: true,
        score: 50,
        reason: 'Unable to validate resume automatically. Manual review required.',
        issues: ['Validation service temporarily unavailable'],
      };
    }
  }

  /**
   * Parse resume from file buffer
   */
  async parseResumeFromFile(
    fileBuffer: Buffer,
    fileType: string
  ): Promise<ParsedResume> {
    const text = await this.extractTextFromResume(fileBuffer, fileType);
    return this.parseResume(text);
  }
}

export default new OpenAIService();
