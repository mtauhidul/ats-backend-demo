import { candidateService } from '../services/firestore/candidate.service';
import { applicationService } from '../services/firestore/application.service';

/**
 * Backfill raw email body for candidates who applied via email automation
 * This script finds candidates with source='email_automation' and updates them
 * with the original email body from the inbound email record
 * 
 * Usage: npx ts-node src/scripts/backfill-email-body.ts
 */

async function backfillEmailBody() {
  console.log('🚀 Starting email body backfill script...\n');
  
  try {
    // Get all applications from email automation
    console.log('📊 Fetching all applications from email automation...');
    const emailApplications = await applicationService.find([
      { field: 'source', operator: '==', value: 'email_automation' },
    ]);
    
    console.log(`   Found ${emailApplications.length} applications from email automation\n`);
    
    if (emailApplications.length === 0) {
      console.log('✅ No email automation applications found');
      return;
    }
    
    let successCount = 0;
    let skipCount = 0;
    let failCount = 0;
    let noCandidateCount = 0;
    
    for (const application of emailApplications) {
      try {
        console.log(`\n🔍 Processing application: ${application.firstName} ${application.lastName} (${application.email})`);
        
        // Skip if application doesn't have email body
        if (!application.rawEmailBody && !application.rawEmailBodyHtml) {
          console.log(`   ⏭️  No email body in application`);
          skipCount++;
          continue;
        }
        
        // Find corresponding candidate
        let candidate = null;
        
        // Try to find by candidate ID from application
        if (application.candidateId) {
          candidate = await candidateService.findById(application.candidateId);
        }
        
        // If not found, try to find by email
        if (!candidate) {
          const candidates = await candidateService.find([
            { field: 'email', operator: '==', value: application.email },
          ]);
          
          if (candidates.length > 0) {
            // Find candidate that has this application ID in applicationIds array
            candidate = candidates.find(c => 
              c.applicationIds && c.applicationIds.includes(application.id!)
            ) || candidates[0];
          }
        }
        
        if (!candidate) {
          console.log(`   ⚠️  No candidate found for this application`);
          noCandidateCount++;
          continue;
        }
        
        console.log(`   ✅ Found candidate: ${candidate.firstName} ${candidate.lastName} (ID: ${candidate.id})`);
        
        // Skip if candidate already has email body
        if (candidate.rawEmailBody || candidate.rawEmailBodyHtml) {
          console.log(`   ⏭️  Candidate already has email body`);
          skipCount++;
          continue;
        }
        
        // Update candidate with email body from application
        const updateData: any = {};
        
        if (application.rawEmailBody) {
          updateData.rawEmailBody = application.rawEmailBody;
          console.log(`   📝 Adding text body (${application.rawEmailBody.length} chars)`);
        }
        
        if (application.rawEmailBodyHtml) {
          updateData.rawEmailBodyHtml = application.rawEmailBodyHtml;
          console.log(`   🌐 Adding HTML body (${application.rawEmailBodyHtml.length} chars)`);
        }
        
        // Also update source if not set
        if (!candidate.source && application.source) {
          updateData.source = application.source;
          console.log(`   🏷️  Setting source: ${application.source}`);
        }
        
        if (Object.keys(updateData).length > 0) {
          await candidateService.update(candidate.id!, updateData);
          console.log(`   ✅ Updated candidate`);
          successCount++;
        } else {
          console.log(`   ⚠️  No data to update`);
          failCount++;
        }
        
      } catch (err) {
        console.error(`   ❌ Error processing application:`, err);
        failCount++;
      }
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('📊 SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total applications: ${emailApplications.length}`);
    console.log(`✅ Successfully updated: ${successCount}`);
    console.log(`⏭️  Skipped (already has data): ${skipCount}`);
    console.log(`⚠️  No candidate found: ${noCandidateCount}`);
    console.log(`❌ Failed: ${failCount}`);
    console.log('='.repeat(80));
    
    console.log('\n✨ Script completed successfully');
    
  } catch (error) {
    console.error('\n❌ Script failed:', error);
    throw error;
  }
}

// Run the script
backfillEmailBody()
  .then(() => {
    console.log('\n👋 Exiting...');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n💥 Fatal error:', err);
    process.exit(1);
  });
