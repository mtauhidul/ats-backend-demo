import admin from 'firebase-admin';
import * as path from 'path';

// Initialize Firebase Admin
const serviceAccountPath = path.join(__dirname, '..', 'firebase_config.json');
const serviceAccount = require(serviceAccountPath);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function checkApplication() {
  try {
    const applicationId = 'fkyTtcCLvYGTXbe3wBrz';
    console.log(`\n🔍 Fetching application with ID: ${applicationId}\n`);

    // Get application document
    const applicationDoc = await db.collection('applications').doc(applicationId).get();

    if (!applicationDoc.exists) {
      console.log('❌ Application not found!\n');
      return;
    }

    const applicationData = applicationDoc.data();
    console.log('✅ Application found!\n');
    console.log('=' .repeat(80));
    console.log('APPLICATION DATA:');
    console.log('=' .repeat(80));
    console.log(JSON.stringify(applicationData, null, 2));
    console.log('=' .repeat(80));

    // Check specific fields
    console.log('\n📊 KEY FIELDS:');
    console.log('─'.repeat(80));
    console.log(`ID: ${applicationDoc.id}`);
    console.log(`Email: ${applicationData?.email || 'N/A'}`);
    console.log(`First Name: ${applicationData?.firstName || 'N/A'}`);
    console.log(`Last Name: ${applicationData?.lastName || 'N/A'}`);
    console.log(`Job ID: ${applicationData?.jobId || 'N/A'}`);
    console.log(`Status: ${applicationData?.status || 'N/A'}`);
    console.log(`Source: ${applicationData?.source || 'N/A'}`);
    console.log(`Created At: ${applicationData?.createdAt?.toDate?.() || applicationData?.createdAt || 'N/A'}`);
    console.log(`Updated At: ${applicationData?.updatedAt?.toDate?.() || applicationData?.updatedAt || 'N/A'}`);

    // Resume fields
    console.log('\n📄 RESUME DATA:');
    console.log('─'.repeat(80));
    console.log(`Resume URL: ${applicationData?.resumeUrl || 'N/A'}`);
    console.log(`Resume Filename: ${applicationData?.resumeFilename || 'N/A'}`);
    console.log(`Resume Text Length: ${applicationData?.resumeText?.length || 0} characters`);

    // Video fields
    console.log('\n🎥 VIDEO DATA:');
    console.log('─'.repeat(80));
    console.log(`Video Intro URL: ${applicationData?.videoIntroUrl || 'N/A'}`);
    console.log(`Video Intro Filename: ${applicationData?.videoIntroFilename || 'N/A'}`);
    console.log(`Video Intro Duration: ${applicationData?.videoIntroDuration || 'N/A'}`);
    console.log(`Video Intro File Size: ${applicationData?.videoIntroFileSize || 'N/A'}`);

    // Parsed data
    if (applicationData?.parsedData) {
      console.log('\n🤖 PARSED DATA:');
      console.log('─'.repeat(80));
      console.log(`Skills: ${applicationData.parsedData.skills?.length || 0} skills`);
      console.log(`Experience: ${applicationData.parsedData.experience?.length || 0} entries`);
      console.log(`Education: ${applicationData.parsedData.education?.length || 0} entries`);
      console.log(`Summary: ${applicationData.parsedData.summary ? 'Yes' : 'No'}`);
      
      if (applicationData.parsedData.skills && applicationData.parsedData.skills.length > 0) {
        console.log(`\nSkills: ${applicationData.parsedData.skills.join(', ')}`);
      }
    }

    // AI validation
    if (applicationData?.isValidResume !== undefined) {
      console.log('\n✨ AI VALIDATION:');
      console.log('─'.repeat(80));
      console.log(`Is Valid Resume: ${applicationData.isValidResume}`);
      console.log(`Validation Score: ${applicationData.validationScore || 'N/A'}`);
      console.log(`Validation Reason: ${applicationData.validationReason || 'N/A'}`);
    }

    // Check if candidate was created from this application
    console.log('\n👤 CANDIDATE CHECK:');
    console.log('─'.repeat(80));
    const candidatesQuery = await db.collection('candidates')
      .where('email', '==', applicationData?.email)
      .get();
    
    if (candidatesQuery.empty) {
      console.log('No candidate found with this email');
    } else {
      console.log(`Found ${candidatesQuery.size} candidate(s) with this email:`);
      candidatesQuery.forEach((doc) => {
        const candidateData = doc.data();
        console.log(`  - Candidate ID: ${doc.id}`);
        console.log(`    Name: ${candidateData.firstName} ${candidateData.lastName}`);
        console.log(`    Status: ${candidateData.status}`);
        console.log(`    Job IDs: ${JSON.stringify(candidateData.jobIds || [])}`);
        console.log(`    Video URL: ${candidateData.videoIntroUrl || 'N/A'}`);
      });
    }

    console.log('\n' + '='.repeat(80));
    console.log('✅ Check complete!\n');

  } catch (error) {
    console.error('❌ Error checking application:', error);
  } finally {
    process.exit(0);
  }
}

checkApplication();
