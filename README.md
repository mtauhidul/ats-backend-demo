# Arista ATS Backend API

Production-ready Node.js/Express backend for Arista ATS (Applicant Tracking System).

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- MongoDB (local or Atlas)
- npm or pnpm

### Installation

```bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env
# Edit .env with your credentials

# Run in development
npm run dev

# Build for production
npm run build
npm start
```

## 📁 Project Structure

```
ats-backend/
├── src/
│   ├── models/         # Mongoose schemas
│   ├── routes/         # Express routes
│   ├── controllers/    # Request handlers
│   ├── services/       # Business logic
│   ├── middleware/     # Auth, validation, error handling
│   ├── utils/          # Helper functions
│   ├── config/         # Configuration
│   ├── types/          # TypeScript types
│   ├── jobs/           # Cron jobs
│   └── server.ts       # Entry point
├── scripts/            # Database seeds, migrations
├── tests/              # Unit & integration tests
└── dist/               # Compiled JavaScript (generated)
```

## 🔧 Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build for production
- `npm start` - Start production server
- `npm test` - Run tests with coverage
- `npm run lint` - Lint code
- `npm run seed` - Seed database with fake data
- `npm run migrate` - Run database migrations

### Utility Scripts

**Reprocess Missing Videos from IMAP** - Directly check IMAP server and recover missing videos:
```bash
# Dry run (check first 50 applications)
npx tsx scripts/reprocess-missing-videos-from-imap.ts

# Live mode (process first 50)
npx tsx scripts/reprocess-missing-videos-from-imap.ts --live

# Process ALL applications
npx tsx scripts/reprocess-missing-videos-from-imap.ts --all --live
```

**Video Recovery** - Recover missing intro videos from stored email records:
```bash
# Dry run (check what would be recovered)
npx tsx scripts/recover-missing-videos.ts

# Live mode (apply changes)
npx tsx scripts/recover-missing-videos.ts --live
```

**Fix Corrupted Applications** - Fix applications with missing/corrupted resume data:
```bash
# Check for corrupted applications
npx tsx scripts/fix-corrupted-applications.ts

# Dry run (see what would change)
npx tsx scripts/fix-corrupted-applications.ts --dry-run

# Fix applications
npx tsx scripts/fix-corrupted-applications.ts --fix
```

## 🔐 Environment Variables

See `.env.example` for all required environment variables.

### Key Services Required:
- **MongoDB Atlas** - Database
- **Clerk** - Authentication
- **Cloudinary** - File storage
- **OpenAI** - AI resume parsing
- **Resend** - Email sending
- **Zoom** - Video interviews (optional)

## 📡 API Endpoints

Base URL: `http://localhost:5000/api/v1`

### Authentication
All endpoints require Clerk JWT token in Authorization header:
```
Authorization: Bearer <clerk_jwt_token>
```

### Core Endpoints

**Users**
- `GET /users` - List users
- `GET /users/:id` - Get user
- `PATCH /users/:id` - Update user

**Clients**
- `GET /clients` - List clients
- `POST /clients` - Create client
- `GET /clients/:id` - Get client
- `PATCH /clients/:id` - Update client
- `DELETE /clients/:id` - Delete client

**Jobs**
- `GET /jobs` - List jobs
- `POST /jobs` - Create job
- `GET /jobs/:id` - Get job details
- `PATCH /jobs/:id` - Update job
- `DELETE /jobs/:id` - Delete job

**Applications**
- `GET /applications` - List applications
- `POST /applications` - Create application
- `GET /applications/:id` - Get application
- `PATCH /applications/:id` - Update application
- `POST /applications/:id/approve` - Approve & create candidate

**Candidates**
- `GET /candidates` - List candidates
- `GET /candidates/:id` - Get candidate
- `PATCH /candidates/:id` - Update candidate
- `POST /candidates/from-application` - Convert application to candidate

**Resume Processing**
- `POST /resumes/parse` - Parse resume (return JSON only)
- `POST /resumes/parse-and-save` - Parse and save to DB

**Email Accounts**
- `GET /email-accounts` - List configured accounts
- `POST /email-accounts` - Add email account
- `PATCH /email-accounts/:id` - Update account
- `DELETE /email-accounts/:id` - Remove account
- `POST /email-accounts/:id/test` - Test connection

**Emails**
- `GET /emails` - List email communications
- `POST /emails/send` - Send email via Resend

**Interviews**
- `GET /interviews` - List interviews
- `POST /interviews` - Schedule interview
- `PATCH /interviews/:id` - Update interview
- `POST /interviews/:id/zoom` - Create Zoom meeting

## 🔄 Email Automation

The system monitors configured email accounts every 15 minutes for new applications:

1. Checks all active email accounts in database
2. Extracts resume attachments
3. Parses resumes with OpenAI
4. Creates applications automatically
5. Logs all activities

Configure email accounts via API or frontend admin panel.

## 🧪 Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm test -- --coverage
```

Tests include:
- Unit tests for services
- Integration tests for API endpoints
- Authentication & authorization tests

## 🚀 Deployment

### Heroku

```bash
# Login to Heroku
heroku login

# Create app
heroku create ats-backend

# Add MongoDB
heroku addons:create mongolab:sandbox

# Set environment variables
heroku config:set CLERK_SECRET_KEY=xxx
heroku config:set OPENAI_API_KEY=xxx
# ... (set all variables from .env)

# Deploy
git push heroku main
```

### Environment Setup
1. Create MongoDB Atlas cluster
2. Setup Clerk application
3. Configure Cloudinary account
4. Get OpenAI API key
5. Setup Resend account
6. Add all credentials to Heroku config vars

## 📊 Database Collections

- **users** - System users (synced with Clerk)
- **clients** - Client companies
- **jobs** - Job openings
- **applications** - Job applications
- **candidates** - Approved candidates
- **emails** - Email communication logs
- **interviews** - Interview schedules
- **categories** - Job categories
- **tags** - Custom tags
- **pipelines** - Custom pipelines
- **teamMembers** - Team member assignments
- **emailAccounts** - Dynamic email accounts for automation

## 🔒 Security Features

- Clerk JWT authentication
- Role-based access control (RBAC)
- Rate limiting
- Helmet.js security headers
- CORS configuration
- Input validation with Zod
- Encrypted email credentials
- SQL injection protection (MongoDB)

## 📝 License

MIT © Arista Groups

## 🤝 Support

For questions or issues, contact the development team.
