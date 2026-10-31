import { PrismaClient } from '@prisma/client';
import fs from 'node:fs';
import path from 'node:path';

// Guarantee that local data and uploads directories exist
const dataDir = path.resolve(process.cwd(), 'data');
const uploadsDir = path.resolve(process.cwd(), 'uploads');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

import { prisma, configureSqliteConcurrency, ensureSqliteWal } from './prisma';

export { prisma, configureSqliteConcurrency, ensureSqliteWal };

let isInitialized = false;

/**
 * Configure SQLite with performance and safety pragmas if using SQLite,
 * or safely return cloud status if connected to PostgreSQL.
 */
export async function initializeDatabasePragmas(): Promise<{
  journalMode: string;
  busyTimeout: number;
  foreignKeys: boolean;
}> {
  const isSqlite = (process.env.DATABASE_URL || '').startsWith('file:');
  if (isSqlite) {
    await configureSqliteConcurrency(prisma);
  }
  isInitialized = true;
  return getDatabasePragmas();
}

export async function getDatabasePragmas(): Promise<{
  journalMode: string;
  busyTimeout: number;
  foreignKeys: boolean;
}> {
  const isSqlite = (process.env.DATABASE_URL || '').startsWith('file:');
  if (!isSqlite) {
    return {
      journalMode: 'SUPABASE_POSTGRES',
      busyTimeout: 0,
      foreignKeys: true,
    };
  }

  const journalResult = await prisma.$queryRawUnsafe<Array<{ journal_mode?: string }>>('PRAGMA journal_mode;');
  const timeoutResult = await prisma.$queryRawUnsafe<Array<{ timeout?: number | bigint | string }>>('PRAGMA busy_timeout;');
  const foreignKeysResult = await prisma.$queryRawUnsafe<Array<{ foreign_keys?: number | bigint | string }>>('PRAGMA foreign_keys;');

  return {
    journalMode: journalResult[0]?.journal_mode?.toLowerCase() ?? 'unknown',
    busyTimeout: Number(timeoutResult[0]?.timeout ?? 0),
    foreignKeys: Boolean(Number(foreignKeysResult[0]?.foreign_keys ?? 0)),
  };
}

export function resolveDatabaseFilePath(): string {
  const envUrl = process.env.DATABASE_URL || '';
  if (envUrl.startsWith('postgres://') || envUrl.startsWith('postgresql://')) {
    return 'Supabase Cloud (ap-southeast-2)';
  }

  if (envUrl && envUrl.startsWith('file:')) {
    const rawPath = envUrl.replace(/^file:/, '').split('?')[0];
    if (path.isAbsolute(rawPath) && fs.existsSync(rawPath)) {
      return rawPath;
    }
    const fromPrisma = path.resolve(process.cwd(), 'prisma', rawPath);
    if (fs.existsSync(fromPrisma)) return fromPrisma;
    const fromCwd = path.resolve(process.cwd(), rawPath);
    if (fs.existsSync(fromCwd)) return fromCwd;
  }

  // Primary location for this application is data/tickets.db
  const dataDb = path.resolve(process.cwd(), 'data', 'tickets.db');
  if (fs.existsSync(dataDb)) {
    return dataDb;
  }

  const prismaDevDb = path.resolve(process.cwd(), 'prisma', 'dev.db');
  if (fs.existsSync(prismaDevDb)) {
    return prismaDevDb;
  }

  return dataDb;
}

export const DB_TRANSACTION_OPTIONS = {
  maxWait: 15000, // Up to 15s to start interactive transaction under high concurrency
  timeout: 30000, // Up to 30s to complete multi-table mutations
};

/**
 * Concurrency retry wrapper to guard against transient lock contentions
 * and transaction collision errors.
 */
export async function withDbRetry<T>(
  operation: () => Promise<T>,
  options: { maxRetries?: number; initialDelayMs?: number } = {}
): Promise<T> {
  const maxRetries = options.maxRetries ?? 5;
  const initialDelayMs = options.initialDelayMs ?? 100;

  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error: any) {
      attempt++;
      const isTransient =
        error?.code === 'P2034' || // Transaction failed due to write conflict
        error?.code === 'P2028' || // Transaction API error (expired/closed/unable to start transaction in time)
        error?.code === 'P2002' || // Unique constraint collision (e.g., sequential taskKey race)
        error?.code === 'P1008' || // Operations timed out (Prisma query queue / socket timeout)
        error?.message?.includes('SQLITE_BUSY') ||
        error?.message?.includes('database is locked') ||
        error?.message?.includes('Transaction') ||
        error?.message?.includes('timeout') ||
        error?.message?.includes('timed out');

      if (attempt >= maxRetries || !isTransient) {
        throw error;
      }
      const delay = initialDelayMs * Math.pow(2, attempt - 1);
      await new Promise((res) => setTimeout(res, delay));
    }
  }
}

// Backwards-compatibility alias for callers expecting withSqliteWriteRetry
export const withSqliteWriteRetry = withDbRetry;

export { dataDir, uploadsDir };
