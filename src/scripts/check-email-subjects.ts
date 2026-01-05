import { candidateService } from '../services/firestore/candidate.service';
import { applicationService } from '../services/firestore/application.service';

/**
 * Check if email subjects are stored in candidates and applications
 */

async function checkEmailSubjects() {
  console.log('🔍 Checking email subjects in database...\n');
  
  try {
    // Get applications with email body
    const appsWithBody = await applicationService.find([
      { field: 'source', operator: '==', value: 'email_automation' },
    ]);
    
    const appsWithSubject = appsWithBody.filter(app => app.emailSubject);
    
    console.log('📊 Applications:');
    console.log(`   Total email automation: ${appsWithBody.length}`);
    console.log(`   With email subject: ${appsWithSubject.length}`);
    console.log(`   Missing subject: ${appsWithBody.length - appsWithSubject.length}\n`);
    
    // Show sample applications with subjects
    console.log('📧 Sample applications with subjects:');
    appsWithSubject.slice(0, 5).forEach(app => {
      console.log(`   • ${app.firstName} ${app.lastName}: "${app.emailSubject}"`);
    });
    
    // Get candidates from email automation
    const allCandidates = await candidateService.findAll();
    const candidates = allCandidates.filter(c => 
      c.source && (c.source === 'email_automation' || c.source === 'email' || c.source.includes('email'))
    );
    
    console.log(`\n📋 Total candidates in system: ${allCandidates.length}`);
    console.log(`   Candidates with source field: ${allCandidates.filter(c => c.source).length}`);
    
    // Show unique source values
    const uniqueSources = [...new Set(allCandidates.map(c => c.source).filter(Boolean))];
    console.log(`   Unique source values: ${uniqueSources.join(', ')}`);
    
    const candidatesWithSubject = candidates.filter(c => c.emailSubject);
    
    console.log('\n👤 Candidates:');
    console.log(`   Total from email: ${candidates.length}`);
    console.log(`   With email subject: ${candidatesWithSubject.length}`);
    console.log(`   Missing subject: ${candidates.length - candidatesWithSubject.length}\n`);
    
    // Show sample candidates with subjects
    console.log('📧 Sample candidates with subjects:');
    candidatesWithSubject.slice(0, 5).forEach(c => {
      console.log(`   • ${c.firstName} ${c.lastName}: "${c.emailSubject}"`);
    });
    
    if (candidatesWithSubject.length === 0) {
      console.log('\n⚠️  No candidates have email subjects yet!');
      console.log('   This might be because:');
      console.log('   1. Applications were not converted to candidates yet');
      console.log('   2. The backfill script found "No candidate found" for applications');
      console.log('   3. Candidates were created before the email subject feature was added');
    }
    
  } catch (error) {
    console.error('\n❌ Error:', error);
  }
  
  process.exit(0);
}

checkEmailSubjects();
