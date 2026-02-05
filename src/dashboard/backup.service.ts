import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import { LoggerService, LogCategory } from './logger.service';

const execAsync = promisify(exec);

@Injectable()
export class BackupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Create a database backup
   * Returns SQL dump as string
   */
  async createBackup(): Promise<string> {
    const startTime = Date.now();
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      throw new InternalServerErrorException('Database URL not configured');
    }

    try {
      this.logger.info(
        '[BACKUP] Starting database backup',
        LogCategory.SYSTEM,
        {
          eventType: 'backup_initiated',
        },
      );

      // Parse database URL to extract connection details
      // Note: For Supabase, use DIRECT_URL (direct connection) for backups/restores
      // Direct connection avoids connection pooling limits
      const url = new URL(databaseUrl);
      const host = url.hostname;
      const port = url.port || '5432';
      const database = url.pathname.slice(1); // Remove leading /
      const username = url.username;
      const password = url.password;

      // Use pg_dump to create SQL backup
      // Set PGPASSWORD environment variable for authentication
      // --no-owner --no-acl: Don't include ownership/ACL (for portability)
      // --clean --if-exists: Drop objects before recreating
      // By default, pg_dump includes BOTH schema AND ALL data from ALL tables
      // No table exclusions or data limits - exports everything
      // Note: This exports all tables, all rows, all columns - complete database backup
      const pgDumpCommand = `pg_dump -h ${host} -p ${port} -U ${username} -d ${database} --no-owner --no-acl --clean --if-exists`;

      const env = {
        ...process.env,
        PGPASSWORD: password,
        PATH: process.env.PATH, // Preserve PATH for pg_dump
      };

      const { stdout, stderr } = await execAsync(pgDumpCommand, {
        env,
        maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large databases
      });

      // pg_dump outputs progress/warnings to stderr, but they're usually safe to ignore
      // Filter out common informational messages
      const stderrFiltered = stderr
        ?.split('\n')
        .filter((line) => {
          const lower = line.toLowerCase();
          return (
            !lower.includes('dumping') &&
            !lower.includes('processing') &&
            !lower.includes('pg_dump:') &&
            line.trim().length > 0
          );
        })
        .join('\n');

      if (stderrFiltered && stderrFiltered.trim().length > 0) {
        this.logger.warn(
          `[BACKUP] pg_dump warnings: ${stderrFiltered}`,
          LogCategory.SYSTEM,
          {
            eventType: 'backup_warning',
            warning: stderrFiltered,
          },
        );
      }

      const duration = Date.now() - startTime;
      const backupSize = Buffer.byteLength(stdout, 'utf8');

      this.logger.info(
        `[BACKUP] Database backup completed successfully (${(backupSize / 1024).toFixed(2)} KB)`,
        LogCategory.SYSTEM,
        {
          eventType: 'backup_success',
          duration,
          sizeBytes: backupSize,
          sizeKB: Math.round(backupSize / 1024),
        },
      );

      return stdout;
    } catch (error) {
      const duration = Date.now() - startTime;

      this.logger.error(
        `[BACKUP] Database backup failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : new Error(String(error)),
        LogCategory.SYSTEM,
        {
          eventType: 'backup_error',
          duration,
        },
      );

      // Fallback: Export via Prisma if pg_dump fails or is not found
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (
        errorMessage.includes('pg_dump') ||
        errorMessage.includes('command not found') ||
        errorMessage.includes('ENOENT')
      ) {
        this.logger.info(
          '[BACKUP] pg_dump not available, falling back to Prisma export method',
          LogCategory.SYSTEM,
        );
        return this.createBackupViaPrisma();
      }

      throw new InternalServerErrorException(
        `Failed to create database backup: ${errorMessage}`,
      );
    }
  }

  /**
   * Fallback method: Export database via Prisma queries
   * This is slower but works without pg_dump
   * Exports ALL tables in the database
   */
  private async createBackupViaPrisma(): Promise<string> {
    try {
      this.logger.info(
        '[BACKUP] Starting Prisma fallback export - exporting all tables',
        LogCategory.SYSTEM,
      );

      // Export ALL tables from the database
      const [
        members,
        products,
        purchases,
        payments,
        deceased,
        yearPlans,
        staff,
        upcoming,
        graves,
        graveSlots,
        waivers,
        assignmentRequests,
        burialNextOfKin,
        commissions,
        smsCampaigns,
        smsOutbox,
        smsLogs,
      ] = await Promise.all([
        this.prisma.member.findMany(),
        this.prisma.product.findMany(),
        this.prisma.purchase.findMany(),
        this.prisma.payment.findMany(),
        this.prisma.deceased.findMany(),
        this.prisma.yearPlan.findMany(),
        this.prisma.staff.findMany(),
        this.prisma.upcoming.findMany(),
        this.prisma.grave.findMany(),
        this.prisma.graveSlot.findMany(),
        this.prisma.waiver.findMany(),
        this.prisma.assignmentRequest.findMany(),
        this.prisma.burialNextOfKin.findMany(),
        this.prisma.commission.findMany(),
        this.prisma.smsCampaign.findMany(),
        this.prisma.smsOutbox.findMany(),
        this.prisma.smsLog.findMany(),
      ]);

      // Generate SQL INSERT statements
      let sql = `-- Database Backup Generated at ${new Date().toISOString()}\n`;
      sql += `-- Generated via Prisma export (fallback method)\n`;
      sql += `-- WARNING: This backup includes data only. Schema must be created via Prisma migrations.\n\n`;

      // Helper function to escape SQL strings
      const escapeSql = (value: any): string => {
        if (value === null || value === undefined) return 'NULL';
        if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
        
        // Handle Date objects (Prisma returns these as Date instances)
        if (value instanceof Date) {
          return `'${value.toISOString()}'`;
        }
        
        // Handle date strings (in case Prisma serializes dates)
        if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
          return `'${value.replace(/'/g, "''")}'`;
        }
        
        // Handle Prisma Decimal type (has toString method)
        if (typeof value === 'object' && value !== null && 'toString' in value && typeof value.toString === 'function') {
          // Check if it's a Decimal-like object
          const str = value.toString();
          // If it looks like a number, use it directly; otherwise JSON stringify
          if (/^-?\d+\.?\d*$/.test(str)) {
            return str;
          }
          return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
        }
        
        // Skip arrays (these are Prisma relations, not database columns)
        // This shouldn't happen with findMany() without include, but we filter them out anyway
        if (Array.isArray(value)) {
          // This is a relation field, should have been filtered out
          return 'NULL'; // Fallback, but this shouldn't be reached
        }
        
        if (typeof value === 'object' && value !== null) {
          // Check if it's a JSON field (like SmsOutbox.payload)
          return `'${JSON.stringify(value).replace(/'/g, "''")}'`;
        }
        
        if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
        if (typeof value === 'number') return String(value);
        return String(value);
      };

      // Helper function to filter out Prisma relation fields (arrays/objects that aren't JSON columns)
      const filterScalarFields = <T>(record: T): Record<string, any> => {
        const filtered: Record<string, any> = {};
        const recordAny = record as any;
        
        for (const key in recordAny) {
          const value = recordAny[key];
          
          // Skip arrays (these are Prisma relations like purchases[], payments[], etc.)
          if (Array.isArray(value)) {
            continue;
          }
          
          // Skip objects that look like Prisma relation objects (have id and other relation fields)
          // But keep objects that are JSON fields (like SmsOutbox.payload)
          if (typeof value === 'object' && value !== null && !(value instanceof Date)) {
            // Check if it's a relation object (has id and looks like a Prisma model)
            // We'll include it if it's likely a JSON field (check table context would be needed)
            // For now, we'll be conservative and include objects (they might be JSON fields)
            // The escapeSql function will handle them
          }
          
          filtered[key] = value;
        }
        
        return filtered;
      };

      // Helper function to generate INSERT statements
      const generateInserts = <T>(
        tableName: string,
        records: T[],
        fieldMapper?: (record: T) => Record<string, any>,
      ) => {
        // Always include table header, even if empty
        let result = `-- ${tableName} (${records.length} records)\n`;
        
        if (records.length === 0) {
          result += `-- No data to export for this table\n\n`;
          return result;
        }
        
        let exportedCount = 0;
        records.forEach((record) => {
          let values: Record<string, any>;
          if (fieldMapper) {
            values = fieldMapper(record);
          } else {
            // Filter out relation fields
            values = filterScalarFields(record);
          }
          
          const keys = Object.keys(values);
          if (keys.length === 0) {
            // Skip records with no scalar fields
            return;
          }
          
          const valuesStr = keys.map((key) => escapeSql(values[key])).join(', ');
          result += `INSERT INTO "${tableName}" (${keys.map((k) => `"${k}"`).join(', ')}) VALUES (${valuesStr});\n`;
          exportedCount++;
        });
        
        if (exportedCount !== records.length) {
          result += `-- Note: ${records.length - exportedCount} record(s) skipped (no scalar fields)\n`;
        }
        
        return result + '\n';
      };

      // Export all tables in dependency order (to maintain referential integrity)
      // Track record counts for logging
      const tableCounts: Record<string, number> = {};
      
      sql += generateInserts('items', products);
      tableCounts['items'] = products.length;
      this.logger.info(`[BACKUP] Exported ${products.length} products`, LogCategory.SYSTEM);
      
      sql += generateInserts('Staff', staff);
      tableCounts['Staff'] = staff.length;
      this.logger.info(`[BACKUP] Exported ${staff.length} staff members`, LogCategory.SYSTEM);
      
      sql += generateInserts('Member', members);
      tableCounts['Member'] = members.length;
      this.logger.info(`[BACKUP] Exported ${members.length} members`, LogCategory.SYSTEM);
      
      sql += generateInserts('year_plans', yearPlans);
      tableCounts['year_plans'] = yearPlans.length;
      this.logger.info(`[BACKUP] Exported ${yearPlans.length} year plans`, LogCategory.SYSTEM);
      
      sql += generateInserts('Purchase', purchases);
      tableCounts['Purchase'] = purchases.length;
      this.logger.info(`[BACKUP] Exported ${purchases.length} purchases`, LogCategory.SYSTEM);
      
      sql += generateInserts('Payment', payments);
      tableCounts['Payment'] = payments.length;
      this.logger.info(`[BACKUP] Exported ${payments.length} payments`, LogCategory.SYSTEM);
      
      sql += generateInserts('Deceased', deceased);
      tableCounts['Deceased'] = deceased.length;
      this.logger.info(`[BACKUP] Exported ${deceased.length} deceased records`, LogCategory.SYSTEM);
      
      sql += generateInserts('upcoming', upcoming);
      tableCounts['upcoming'] = upcoming.length;
      this.logger.info(`[BACKUP] Exported ${upcoming.length} upcoming items`, LogCategory.SYSTEM);
      
      sql += generateInserts('Grave', graves);
      tableCounts['Grave'] = graves.length;
      this.logger.info(`[BACKUP] Exported ${graves.length} graves`, LogCategory.SYSTEM);
      
      sql += generateInserts('GraveSlot', graveSlots);
      tableCounts['GraveSlot'] = graveSlots.length;
      this.logger.info(`[BACKUP] Exported ${graveSlots.length} grave slots`, LogCategory.SYSTEM);
      
      sql += generateInserts('Waiver', waivers);
      tableCounts['Waiver'] = waivers.length;
      this.logger.info(`[BACKUP] Exported ${waivers.length} waivers`, LogCategory.SYSTEM);
      
      sql += generateInserts('AssignmentRequest', assignmentRequests);
      tableCounts['AssignmentRequest'] = assignmentRequests.length;
      this.logger.info(`[BACKUP] Exported ${assignmentRequests.length} assignment requests`, LogCategory.SYSTEM);
      
      sql += generateInserts('BurialNextOfKin', burialNextOfKin);
      tableCounts['BurialNextOfKin'] = burialNextOfKin.length;
      this.logger.info(`[BACKUP] Exported ${burialNextOfKin.length} burial next of kin records`, LogCategory.SYSTEM);
      
      sql += generateInserts('Commission', commissions);
      tableCounts['Commission'] = commissions.length;
      this.logger.info(`[BACKUP] Exported ${commissions.length} commissions`, LogCategory.SYSTEM);
      
      sql += generateInserts('SmsCampaign', smsCampaigns);
      tableCounts['SmsCampaign'] = smsCampaigns.length;
      this.logger.info(`[BACKUP] Exported ${smsCampaigns.length} SMS campaigns`, LogCategory.SYSTEM);
      
      sql += generateInserts('SmsOutbox', smsOutbox);
      tableCounts['SmsOutbox'] = smsOutbox.length;
      this.logger.info(`[BACKUP] Exported ${smsOutbox.length} SMS outbox records`, LogCategory.SYSTEM);
      
      sql += generateInserts('SmsLog', smsLogs);
      tableCounts['SmsLog'] = smsLogs.length;
      this.logger.info(`[BACKUP] Exported ${smsLogs.length} SMS logs`, LogCategory.SYSTEM);

      // Add summary at the end
      const totalRecords = Object.values(tableCounts).reduce((sum, count) => sum + count, 0);
      sql += `\n-- Backup Summary\n`;
      sql += `-- Total tables exported: 17\n`;
      sql += `-- Total records exported: ${totalRecords}\n`;
      sql += `-- Table breakdown:\n`;
      Object.entries(tableCounts).forEach(([table, count]) => {
        sql += `--   ${table}: ${count} record(s)\n`;
      });
      sql += `-- Backup completed at: ${new Date().toISOString()}\n`;

      const backupSize = Buffer.byteLength(sql, 'utf8');
      this.logger.info(
        `[BACKUP] Prisma fallback export completed (${(backupSize / 1024).toFixed(2)} KB, ${totalRecords} total records)`,
        LogCategory.SYSTEM,
        {
          eventType: 'backup_prisma_success',
          sizeBytes: backupSize,
          tablesExported: 17,
          totalRecords,
          tableCounts,
        },
      );

      return sql;
    } catch (error) {
      this.logger.error(
        `[BACKUP] Prisma fallback export failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : new Error(String(error)),
        LogCategory.SYSTEM,
      );
      throw new InternalServerErrorException(
        `Failed to create backup via Prisma: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  /**
   * Get backup filename with timestamp
   */
  getBackupFilename(): string {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    return `etosha-backup-${timestamp}.sql`;
  }

  /**
   * Restore database from SQL backup file
   * @param sqlFilePath Path to the SQL backup file
   * @param options Restore options
   */
  async restoreBackup(
    sqlFilePath: string,
    options?: {
      createBackupFirst?: boolean;
      dropExisting?: boolean;
    },
  ): Promise<void> {
    const startTime = Date.now();
    const databaseUrl = process.env.DATABASE_URL;

    if (!databaseUrl) {
      throw new InternalServerErrorException('Database URL not configured');
    }

    const {
      createBackupFirst = true,
      dropExisting = false,
    } = options || {};

    try {
      this.logger.info(
        '[RESTORE] Starting database restore',
        LogCategory.SYSTEM,
        {
          eventType: 'restore_initiated',
          sqlFilePath,
          createBackupFirst,
          dropExisting,
        },
      );

      // Step 1: Create safety backup if requested
      if (createBackupFirst) {
        this.logger.info(
          '[RESTORE] Creating safety backup before restore',
          LogCategory.SYSTEM,
        );
        const safetyBackup = await this.createBackup();
        const safetyFilename = `safety-backup-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)}.sql`;
        const safetyPath = path.join(process.cwd(), 'backups', safetyFilename);
        await fs.mkdir(path.dirname(safetyPath), { recursive: true });
        await fs.writeFile(safetyPath, safetyBackup, 'utf8');
        this.logger.info(
          `[RESTORE] Safety backup created: ${safetyPath}`,
          LogCategory.SYSTEM,
        );
      }

      // Step 2: Read SQL file
      const sql = await fs.readFile(sqlFilePath, 'utf8');

      // Step 3: Parse database URL
      // Note: For Supabase, ensure you're using DIRECT_URL (direct connection, port 5432)
      // Connection pooling (port 6543) may have limitations for restore operations
      const url = new URL(databaseUrl);
      const host = url.hostname;
      const port = url.port || '5432';
      const database = url.pathname.slice(1);
      const username = url.username;
      const password = url.password;

      // Step 4: Drop existing schema if requested
      if (dropExisting) {
        this.logger.warn(
          '[RESTORE] Dropping existing database schema',
          LogCategory.SYSTEM,
        );
        const dropCommand = `psql -h ${host} -p ${port} -U ${username} -d ${database} -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"`;
        const env = {
          ...process.env,
          PGPASSWORD: password,
        };
        await execAsync(dropCommand, { env });
      }

      // Step 5: Restore SQL file
      const restoreCommand = `psql -h ${host} -p ${port} -U ${username} -d ${database} -f "${sqlFilePath}"`;
      const env = {
        ...process.env,
        PGPASSWORD: password,
      };

      const { stdout, stderr } = await execAsync(restoreCommand, {
        env,
        maxBuffer: 50 * 1024 * 1024,
      });

      if (stderr && stderr.trim().length > 0) {
        // Filter out informational messages
        const stderrFiltered = stderr
          .split('\n')
          .filter((line) => {
            const lower = line.toLowerCase();
            return (
              !lower.includes('psql:') &&
              !lower.includes('setting') &&
              !lower.includes('encoding') &&
              line.trim().length > 0
            );
          })
          .join('\n');

        if (stderrFiltered && stderrFiltered.trim().length > 0) {
          this.logger.warn(
            `[RESTORE] psql warnings: ${stderrFiltered}`,
            LogCategory.SYSTEM,
            {
              eventType: 'restore_warning',
              warning: stderrFiltered,
            },
          );
        }
      }

      const duration = Date.now() - startTime;
      this.logger.info(
        `[RESTORE] Database restore completed successfully in ${duration}ms`,
        LogCategory.SYSTEM,
        {
          eventType: 'restore_success',
          duration,
          sqlFilePath,
        },
      );

      // Step 6: Regenerate Prisma Client
      this.logger.info(
        '[RESTORE] Regenerating Prisma Client',
        LogCategory.SYSTEM,
      );
      await execAsync('npx prisma generate', {
        cwd: process.cwd(),
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(
        `[RESTORE] Database restore failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        error instanceof Error ? error : new Error(String(error)),
        LogCategory.SYSTEM,
        {
          eventType: 'restore_error',
          duration,
          sqlFilePath,
        },
      );
      throw new InternalServerErrorException(
        `Failed to restore database: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }
}
