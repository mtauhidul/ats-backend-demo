/**
 * Check for duplicate applications and identify the root cause
 */

import admin from 'firebase-admin';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const serviceAccount = require('../firebase_config.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function checkDuplicates() {
  console.log('\n🔍 CHECKING FOR DUPLICATE APPLICATIONS');
  console.log('='.repeat(70));
  
  try {
    // Get all applications
    const appsSnapshot = await db.collection('applications').get();
    
    console.log(`\n📊 Total applications: ${appsSnapshot.size}`);
    
    // Group by email
    const emailMap = new Map<string, any[]>();
    
    appsSnapshot.forEach((doc) => {
      const data = doc.data();
      const email = data.email?.toLowerCase().trim();
      
      if (!email) {
        console.log(`⚠️  Application ${doc.id} has no email`);
        return;
      }
      
      if (!emailMap.has(email)) {
        emailMap.set(email, []);
      }
      
      emailMap.get(email)!.push({
        id: doc.id,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        source: data.source,
        createdAt: data.createdAt?.toDate?.() || null,
        sourceEmailAccountId: data.sourceEmailAccountId,
        messageId: data.messageId,
        status: data.status,
      });
    });
    
    // Find duplicates
    const duplicates: any[] = [];
    
    emailMap.forEach((apps, email) => {
      if (apps.length > 1) {
        duplicates.push({ email, apps });
      }
    });
    
    console.log(`\n🔴 Found ${duplicates.length} emails with duplicate applications\n`);
    
    if (duplicates.length === 0) {
      console.log('✅ No duplicates found!');
      return;
    }
    
    // Analyze duplicates
    for (const dup of duplicates) {
      console.log(`\n${'='.repeat(70)}`);
      console.log(`📧 Email: ${dup.email}`);
      console.log(`   Total applications: ${dup.apps.length}`);
      console.log('');
      
      dup.apps.sort((a: any, b: any) => {
        if (!a.createdAt) return 1;
        if (!b.createdAt) return -1;
        return a.createdAt.getTime() - b.createdAt.getTime();
      });
      
      dup.apps.forEach((app: any, index: number) => {
        console.log(`   ${index + 1}. Application ID: ${app.id}`);
        console.log(`      Name: ${app.firstName} ${app.lastName}`);
        console.log(`      Source: ${app.source || 'unknown'}`);
        console.log(`      Status: ${app.status || 'unknown'}`);
        console.log(`      Created: ${app.createdAt ? app.createdAt.toISOString() : 'unknown'}`);
        console.log(`      Account ID: ${app.sourceEmailAccountId || 'none'}`);
        console.log('');
      });
      
      // Check time difference between duplicates
      if (dup.apps.length >= 2 && dup.apps[0].createdAt && dup.apps[1].createdAt) {
        const timeDiff = Math.abs(
          dup.apps[1].createdAt.getTime() - dup.apps[0].createdAt.getTime()
        );
        const seconds = Math.floor(timeDiff / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        
        console.log(`   ⏱️  Time between duplicates:`);
        if (hours > 0) {
          console.log(`      ${hours} hours, ${minutes % 60} minutes, ${seconds % 60} seconds`);
        } else if (minutes > 0) {
          console.log(`      ${minutes} minutes, ${seconds % 60} seconds`);
        } else {
          console.log(`      ${seconds} seconds`);
        }
        
        if (seconds < 5) {
          console.log(`      🔴 RACE CONDITION! Duplicates created within ${seconds} seconds`);
        } else if (seconds < 60) {
          console.log(`      ⚠️  Created very close together (${seconds} seconds)`);
        }
      }
    }
    
    // Summary and recommendations
    console.log(`\n${'='.repeat(70)}`);
    console.log('📊 DUPLICATE ANALYSIS SUMMARY');
    console.log('='.repeat(70));
    
    // Count by source
    const bySource = new Map<string, number>();
    duplicates.forEach(dup => {
      dup.apps.forEach((app: any) => {
        const source = app.source || 'unknown';
        bySource.set(source, (bySource.get(source) || 0) + 1);
      });
    });
    
    console.log('\n📈 Duplicates by source:');
    bySource.forEach((count, source) => {
      console.log(`   ${source}: ${count}`);
    });
    
    // Identify likely causes
    console.log('\n🔍 Likely causes:');
    
    const raceConditions = duplicates.filter(dup => {
      if (dup.apps.length < 2) return false;
      if (!dup.apps[0].createdAt || !dup.apps[1].createdAt) return false;
      const timeDiff = Math.abs(
        dup.apps[1].createdAt.getTime() - dup.apps[0].createdAt.getTime()
      );
      return timeDiff < 5000; // Less than 5 seconds
    });
    
    if (raceConditions.length > 0) {
      console.log(`   🔴 ${raceConditions.length} duplicate(s) likely from RACE CONDITIONS`);
      console.log(`      Multiple processes checking for duplicates simultaneously`);
      console.log(`      before any application was created.`);
    }
    
    const emailAutomation = duplicates.filter(dup => 
      dup.apps.every((app: any) => app.source === 'email_automation')
    );
    
    if (emailAutomation.length > 0) {
      console.log(`   ⚠️  ${emailAutomation.length} duplicate(s) from EMAIL AUTOMATION`);
      console.log(`      Could be from:`)
      console.log(`      - Bulk import processing same emails as regular automation`);
      console.log(`      - Email marked as unread multiple times`);
      console.log(`      - Multiple automation runs before email marked as processed`);
    }
    
    console.log('\n💡 RECOMMENDATIONS:');
    console.log('   1. Add unique constraint on email field (Firestore doesn\'t support this natively)');
    console.log('   2. Use transaction to check + create application atomically');
    console.log('   3. Store messageId with application and check for duplicates by messageId');
    console.log('   4. Mark emails as "processing" before creating application');
    console.log('   5. Add distributed lock mechanism for email processing');
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run
checkDuplicates()
  .then(() => {
    console.log('\n✓ Check completed\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Check failed:', error);
    process.exit(1);
  });
