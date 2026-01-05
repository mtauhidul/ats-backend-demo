# Fetch Raw Email Script

This script fetches emails directly from Gmail IMAP and displays the complete raw email content.

## Setup

### 1. Generate Gmail App Password

Since you're using Gmail, you need to create an App Password:

1. Go to your Google Account: https://myaccount.google.com/
2. Navigate to **Security** → **2-Step Verification** (enable it if not already enabled)
3. Go to **App passwords**: https://myaccount.google.com/apppasswords
4. Select app: **Mail**
5. Select device: **Other (Custom name)** → Enter "ATS Email Fetch"
6. Click **Generate**
7. Copy the 16-character password

### 2. Add Password to Script

Edit `fetch-raw-email.ts` and add your app password:

```typescript
const IMAP_CONFIG = {
  user: 'donlancelotknight123@gmail.com',
  password: 'xxxx xxxx xxxx xxxx', // <- PASTE YOUR APP PASSWORD HERE
  host: 'imap.gmail.com',
  port: 993,
  tls: true,
  tlsOptions: { rejectUnauthorized: false },
};
```

### 3. Install Dependencies (if needed)

Make sure you have the required packages:

```bash
cd ats-backend
pnpm install imap mailparser @types/imap @types/mailparser
```

## Usage

Run the script from the backend directory:

```bash
cd ats-backend
npx ts-node src/scripts/fetch-raw-email.ts
```

Or add a script to package.json:

```json
"scripts": {
  "fetch:email": "ts-node src/scripts/fetch-raw-email.ts"
}
```

Then run:

```bash
pnpm run fetch:email
```

## What It Shows

The script will display:

- **Metadata**: From, To, Subject, Date, Message-ID
- **Attachments**: List of all attachments with size
- **Text Body**: Plain text version
- **HTML Body**: HTML version (first 500 chars preview)
- **Raw Headers**: All email headers
- **Complete Raw Email**: Full raw email content

## Configuration

You can modify these settings in the script:

```typescript
// Number of most recent emails to fetch
const FETCH_COUNT = 5;

// To fetch from a different folder (default is INBOX)
imap.openBox('INBOX', true, callback);
```

## Troubleshooting

### Error: Invalid credentials

- Make sure you're using an App Password, not your regular Gmail password
- Double-check that 2-Step Verification is enabled
- Verify the email address is correct

### Error: Connection timeout

- Check your internet connection
- Verify firewall isn't blocking port 993
- Try setting `tlsOptions: { rejectUnauthorized: false }`

### No emails found

- The script fetches from INBOX by default
- Check if emails are in a different folder
- Verify there are actually emails in the inbox

## Security Notes

⚠️ **NEVER commit the App Password to Git!**

Add the password only in your local copy and make sure it's not tracked by version control.

Consider using environment variables:

```typescript
const IMAP_CONFIG = {
  user: process.env.GMAIL_USER || 'donlancelotknight123@gmail.com',
  password: process.env.GMAIL_APP_PASSWORD || '',
  // ...
};
```

Then run:

```bash
GMAIL_APP_PASSWORD="xxxx xxxx xxxx xxxx" npx ts-node src/scripts/fetch-raw-email.ts
```
