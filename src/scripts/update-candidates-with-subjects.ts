import { candidateService } from '../services/firestore/candidate.service';
import { applicationService } from '../services/firestore/application.service';

/**
 * Update candidates with email subject from their applications
 */

async function updateCandidatesWithEmailSubjects() {
  console.log('🚀 Updating candidates with email subjects from applications...\n');
  
  try {
    // Get all applications with email subjects
    const apps = await applicationService.find([
      { field: 'source', operator: '==', value: 'email_automation' },
    ]);
    
    const appsWithSubject = apps.filter(app => app.emailSubject && app.candidateId);
    
    console.log(`📊 Found ${appsWithSubject.length} applications with email subject and candidateId\n`);
    
    let updated = 0;
    let skipped = 0;
    let notFound = 0;
    
    for (const app of appsWithSubject) {
      try {
        const candidate = await candidateService.findById(app.candidateId!);
        
        if (!candidate) {
          console.log(`⚠️  Candidate not found for application: ${app.firstName} ${app.lastName}`);
          notFound++;
          continue;
        }
        
        if (candidate.emailSubject) {
          console.log(`⏭️  ${candidate.firstName} ${candidate.lastName} already has subject`);
          skipped++;
          continue;
        }
        
        // Update candidate
        await candidateService.update(candidate.id!, {
          emailSubject: app.emailSubject,
          source: 'email_automation', // Also fix the source
          rawEmailBody: app.rawEmailBody || candidate.rawEmailBody,
          rawEmailBodyHtml: app.rawEmailBodyHtml || candidate.rawEmailBodyHtml,
        });
        
        console.log(`✅ Updated ${candidate.firstName} ${candidate.lastName}: "${app.emailSubject}"`);
        updated++;
        
      } catch (err: any) {
        console.error(`❌ Error updating candidate: ${err.message}`);
      }
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('📊 SUMMARY');
    console.log('='.repeat(80));
    console.log(`✅ Updated: ${updated}`);
    console.log(`⏭️  Skipped (already has subject): ${skipped}`);
    console.log(`⚠️  Candidate not found: ${notFound}`);
    console.log('='.repeat(80));
    
  } catch (error) {
    console.error('\n❌ Error:', error);
  }
  
  process.exit(0);
}

updateCandidatesWithEmailSubjects();
