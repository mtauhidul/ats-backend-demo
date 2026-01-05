# Email Body Backfill Script

This script backfills the raw email body content for existing candidates who were created through email automation but don't have the email content stored yet.

## What It Does

1. Finds all candidates with `source = 'email_automation'` or `source = 'email'`
2. Checks if they already have `rawEmailBody` or `rawEmailBodyHtml`
3. If not, looks up the original inbound email from the database
4. Updates the candidate record with the raw email body (text and HTML)

## Usage

Run from the backend directory:

```bash
cd ats-backend
npx ts-node src/scripts/backfill-email-body.ts
```

Or add to package.json scripts:

```json
{
  "scripts": {
    "backfill:email-body": "ts-node src/scripts/backfill-email-body.ts"
  }
}
```

Then run:

```bash
pnpm run backfill:email-body
```

## What Gets Updated

For each candidate found:
- `rawEmailBody` - Plain text version of the email
- `rawEmailBodyHtml` - HTML version of the email (if available)

## Safety

- ✅ **Non-destructive**: Only updates candidates that don't already have email body data
- ✅ **Idempotent**: Can be run multiple times safely
- ✅ **Logging**: Detailed progress and error logging
- ✅ **Summary**: Shows counts of successful, skipped, and failed updates

## Output Example

```
🚀 Starting email body backfill script...

📊 Fetching all candidates...
   Found 150 total candidates

📧 Found 23 candidates from email automation

🔍 Processing: John Doe (john@example.com)
   ✅ Found application: app_123
   ✅ Found email: Application for Software Engineer
   📝 Adding text body (1523 chars)
   🌐 Adding HTML body (3421 chars)
   ✅ Updated candidate

⏭️  Skipping Jane Smith - already has email body

================================================================================
📊 SUMMARY
================================================================================
Total candidates: 23
✅ Successfully updated: 18
⏭️  Skipped (already has data): 4
❌ Failed: 1
================================================================================
```

## When to Run

- **After deploying the new email body storage feature** - to backfill existing candidates
- **After data migration** - if candidates were imported without email bodies
- **For data recovery** - if email bodies were accidentally deleted

## Requirements

- Firestore must have:
  - `candidates` collection with email automation candidates
  - `applications` collection with source tracking
  - `emails` collection with inbound email records linked to applications

## Troubleshooting

### No emails found for candidate

The script looks for emails by:
1. Application ID from candidate's `applicationIds` array
2. Email address and source matching

If no email is found, it means:
- The email record wasn't created during automation
- The email was deleted
- The candidate was manually created (not from automation)

### Failed updates

Check the logs for specific error messages. Common issues:
- Database connection problems
- Missing permissions
- Corrupted email data

## Related Features

This script supports the new **Email Content Display** feature in the candidate details page, which shows the original email body under "Documents & Media" for candidates who applied via email.
