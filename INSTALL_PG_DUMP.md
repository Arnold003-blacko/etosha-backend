# Installing PostgreSQL pg_dump Tool

## Option 1: Railway Deployment (Recommended)

If you're deploying to Railway, the `Dockerfile` I created will automatically install `pg_dump`. Just make sure Railway uses the Dockerfile:

1. **Railway will automatically detect and use the Dockerfile**
2. The Dockerfile includes: `postgresql-client` which contains `pg_dump`
3. No additional steps needed - just deploy!

## Option 2: Local Windows Development

### Method A: Install PostgreSQL (Full Installation)

1. Download PostgreSQL from: https://www.postgresql.org/download/windows/
2. Run the installer
3. During installation, make sure to install "Command Line Tools"
4. After installation, `pg_dump` will be available in:
   - `C:\Program Files\PostgreSQL\{version}\bin\pg_dump.exe`
5. Add to PATH (optional but recommended):
   - Add `C:\Program Files\PostgreSQL\{version}\bin` to your system PATH
   - Or use the full path in the backup service

### Method B: Install Only PostgreSQL Client Tools (Lighter)

1. Download PostgreSQL client tools from: https://www.enterprisedb.com/download-postgresql-binaries
2. Extract to a folder (e.g., `C:\PostgreSQL\bin`)
3. Add to PATH or use full path

### Verify Installation

Open PowerShell/CMD and run:
```bash
pg_dump --version
```

You should see something like: `pg_dump (PostgreSQL) 15.x`

## Option 3: Use Prisma Fallback (No Installation Needed)

The backup service already has a fallback that uses Prisma to export data. This works without `pg_dump` but:
- ✅ No installation needed
- ✅ Works everywhere
- ⚠️ Slower for large databases
- ⚠️ Less complete (may miss some database features)

The fallback will automatically activate if `pg_dump` is not found.

## Troubleshooting

### Railway: pg_dump not found

If Railway doesn't use the Dockerfile:
1. Check Railway settings to ensure Dockerfile is being used
2. Or add a `railway.json` or `nixpacks.toml` to install postgresql-client

### Local: Command not found

1. Check if PostgreSQL is installed: `where pg_dump` (Windows)
2. Verify PATH includes PostgreSQL bin directory
3. Restart your terminal/IDE after adding to PATH
4. Use full path: `C:\Program Files\PostgreSQL\15\bin\pg_dump.exe`

### Test the Backup

Once installed, test the backup endpoint:
```bash
GET /dashboard/backup
```

If `pg_dump` fails, it will automatically fall back to Prisma export method.
