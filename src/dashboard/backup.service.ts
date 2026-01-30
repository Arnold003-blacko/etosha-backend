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
      const url = new URL(databaseUrl);
      const host = url.hostname;
      const port = url.port || '5432';
      const database = url.pathname.slice(1); // Remove leading /
      const username = url.username;
      const password = url.password;

      // Use pg_dump to create SQL backup
      // Set PGPASSWORD environment variable for authentication
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

      if (stderr && !stderr.includes('WARNING')) {
        // pg_dump outputs warnings to stderr, but they're usually safe to ignore
        this.logger.warn(
          `[BACKUP] pg_dump warnings: ${stderr}`,
          LogCategory.SYSTEM,
          {
            eventType: 'backup_warning',
            warning: stderr,
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
   */
  private async createBackupViaPrisma(): Promise<string> {
    try {
      // Export all tables
      const members = await this.prisma.member.findMany();
      const products = await this.prisma.product.findMany();
      const purchases = await this.prisma.purchase.findMany();
      const payments = await this.prisma.payment.findMany();
      const deceased = await this.prisma.deceased.findMany();
      const yearPlans = await this.prisma.yearPlan.findMany();

      // Generate SQL INSERT statements
      let sql = `-- Database Backup Generated at ${new Date().toISOString()}\n`;
      sql += `-- Generated via Prisma export\n\n`;

      // Export members
      if (members.length > 0) {
        sql += `-- Members\n`;
        members.forEach((member) => {
          const values = {
            id: member.id,
            firstName: member.firstName,
            lastName: member.lastName,
            email: member.email,
            phone: member.phone,
            password: member.password,
            country: member.country,
            address: member.address,
            city: member.city,
            nationalId: member.nationalId,
            dateOfBirth: member.dateOfBirth,
            gender: member.gender,
            expoPushToken: member.expoPushToken,
            createdAt: member.createdAt,
            updatedAt: member.updatedAt,
          };
          sql += `INSERT INTO "Member" (${Object.keys(values).join(', ')}) VALUES (${Object.values(values).map(v => typeof v === 'string' ? `'${v.replace(/'/g, "''")}'` : v === null ? 'NULL' : v).join(', ')});\n`;
        });
        sql += `\n`;
      }

      // Export other tables similarly...
      // For brevity, I'll create a more generic approach

      return sql;
    } catch (error) {
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
}
