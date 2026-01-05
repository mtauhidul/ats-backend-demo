import { candidateService } from '../services/firestore/candidate.service';
import { applicationService } from '../services/firestore/application.service';
import { emailService } from '../services/firestore/email.service';

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
    // Get all candidates
    console.log('📊 Fetching all candidates...');
    const allCandidates = await candidateService.findAll();
    console.log(`   Found ${allCandidates.length} total candidates\n`);
    
    // Filter candidates who applied via email
    const emailCandidates = allCandidates.filter(c => 
      c.source === 'email_automation' || c.source === 'email'
    );
    
    console.log(`📧 Found ${emailCandidates.length} candidates from email automation\n`);
    
    if (emailCandidates.length === 0) {
      console.log('✅ No candidates to update');
      return;
    }
    
    let successCount = 0;
    let skipCount = 0;
    let failCount = 0;
    
    for (const candidate of emailCandidates) {
      try {
        // Skip if already has email body
        if (candidate.rawEmailBody || candidate.rawEmailBodyHtml) {
          console.log(`⏭️  Skipping ${candidate.firstName} ${candidate.lastName} - already has email body`);
          skipCount++;
          continue;
        }
        
        console.log(`\n🔍 Processing: ${candidate.firstName} ${candidate.lastName} (${candidate.email})`);
        
        // Find the original application
        let application = null;
        
        // Try to find by candidate's application IDs
        if (candidate.applicationIds && candidate.applicationIds.length > 0) {
          const appId = candidate.applicationIds[0];
          application = await applicationService.findById(appId);
        }
        
        // If not found, try to find by email and source
        if (!application) {
          const applications = await applicationService.find([
            { field: 'email', operator: '==', value: candidate.email },
            { field: 'source', operator: '==', value: 'email_automation' },
          ]);
          
          if (applications.length > 0) {
            application = applications[0];
          }
        }
        
        if (!application) {
          console.log(`   ⚠️  No application found`);
          failCount++;
          continue;
        }
        
        console.log(`   ✅ Found application: ${application.id}`);
        
        // Find the inbound email using application ID
        const emails = await emailService.find([
          { field: 'applicationId', operator: '==', value: application.id },
          { field: 'direction', operator: '==', value: 'inbound' },
        ]);
        
        if (emails.length === 0) {
          console.log(`   ⚠️  No inbound email found`);
          failCount++;
          continue;
        }
        
        const email = emails[0];
        console.log(`   ✅ Found email: ${email.subject}`);
        
        // Update candidate with email body
        const updateData: any = {};
        
        if (email.body) {
          updateData.rawEmailBody = email.body;
          console.log(`   📝 Adding text body (${email.body.length} chars)`);
        }
        
        if (email.bodyHtml) {
          updateData.rawEmailBodyHtml = email.bodyHtml;
          console.log(`   🌐 Adding HTML body (${email.bodyHtml.length} chars)`);
        }
        
        if (Object.keys(updateData).length > 0) {
          await candidateService.update(candidate.id!, updateData);
          console.log(`   ✅ Updated candidate`);
          successCount++;
        } else {
          console.log(`   ⚠️  No email body to add`);
          failCount++;
        }
        
      } catch (err) {
        console.error(`   ❌ Error processing candidate:`, err);
        failCount++;
      }
    }
    
    console.log('\n' + '='.repeat(80));
    console.log('📊 SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total candidates: ${emailCandidates.length}`);
    console.log(`✅ Successfully updated: ${successCount}`);
    console.log(`⏭️  Skipped (already has data): ${skipCount}`);
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
