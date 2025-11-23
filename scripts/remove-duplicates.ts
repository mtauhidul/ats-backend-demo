/**
 * Delete duplicate applications (keeping the oldest one)
 */

import admin from 'firebase-admin';
import dotenv from 'dotenv';
import path from 'path';
import * as readline from 'readline';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const serviceAccount = require('../firebase_config.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

// Create readline interface for user confirmation
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query: string): Promise<string> {
  return new Promise(resolve => {
    rl.question(query, resolve);
  });
}

async function removeDuplicates() {
  console.log('\n🧹 REMOVING DUPLICATE APPLICATIONS');
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
      
      if (!email) return;
      
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
      console.log('✅ No duplicates to remove!');
      rl.close();
      return;
    }
    
    // Show duplicates
    for (const dup of duplicates) {
      console.log(`\n${'='.repeat(70)}`);
      console.log(`📧 Email: ${dup.email}`);
      console.log(`   Total applications: ${dup.apps.length}`);
      console.log('');
      
      // Sort by creation date (oldest first)
      dup.apps.sort((a: any, b: any) => {
        if (!a.createdAt) return 1;
        if (!b.createdAt) return -1;
        return a.createdAt.getTime() - b.createdAt.getTime();
      });
      
      dup.apps.forEach((app: any, index: number) => {
        const badge = index === 0 ? '✅ KEEP' : '❌ DELETE';
        console.log(`   ${index + 1}. ${badge} - Application ID: ${app.id}`);
        console.log(`      Name: ${app.firstName} ${app.lastName}`);
        console.log(`      Status: ${app.status || 'unknown'}`);
        console.log(`      Created: ${app.createdAt ? app.createdAt.toISOString() : 'unknown'}`);
        console.log('');
      });
    }
    
    console.log(`\n${'='.repeat(70)}`);
    console.log('📊 SUMMARY');
    console.log('='.repeat(70));
    console.log(`Emails with duplicates: ${duplicates.length}`);
    
    let totalToDelete = 0;
    duplicates.forEach(dup => {
      totalToDelete += dup.apps.length - 1; // Keep one, delete rest
    });
    
    console.log(`Applications to keep: ${duplicates.length}`);
    console.log(`Applications to delete: ${totalToDelete}`);
    
    // Ask for confirmation
    console.log('\n⚠️  WARNING: This will permanently delete duplicate applications!');
    const answer = await question('\nDo you want to proceed? (yes/no): ');
    
    if (answer.toLowerCase() !== 'yes') {
      console.log('\n❌ Operation cancelled');
      rl.close();
      return;
    }
    
    // Delete duplicates
    console.log('\n🗑️  Deleting duplicates...\n');
    
    let deleted = 0;
    
    for (const dup of duplicates) {
      // Keep the first (oldest), delete the rest
      for (let i = 1; i < dup.apps.length; i++) {
        const app = dup.apps[i];
        console.log(`   Deleting: ${app.firstName} ${app.lastName} (${app.id})`);
        await db.collection('applications').doc(app.id).delete();
        deleted++;
      }
    }
    
    console.log(`\n✅ Successfully deleted ${deleted} duplicate application(s)`);
    console.log(`✅ Kept ${duplicates.length} original application(s)\n`);
    
    rl.close();
    
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    rl.close();
    process.exit(1);
  }
}

// Run
removeDuplicates()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('Script failed:', error);
    rl.close();
    process.exit(1);
  });
