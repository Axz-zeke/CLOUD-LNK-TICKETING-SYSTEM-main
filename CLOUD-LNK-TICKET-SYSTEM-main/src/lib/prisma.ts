import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  sqliteConfigured: boolean | undefined;
};

const defaultDbUrl =
  process.env.DATABASE_URL || 'file:../data/tickets.db?connection_limit=1&socket_timeout=30';

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    datasourceUrl: defaultDbUrl,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

if (prisma && !(prisma as any).ticketHistory) {
  Object.defineProperty(prisma, 'ticketHistory', {
    get() {
      return (prisma as any).taskHistory;
    },
    configurable: true,
  });
}

export async function configureSqliteConcurrency(client: PrismaClient = prisma): Promise<void> {
  const isSqlite = (process.env.DATABASE_URL || '').startsWith('file:');
  if (!isSqlite) return;
  if (globalForPrisma.sqliteConfigured) return;
  try {
    await client.$queryRawUnsafe('PRAGMA journal_mode = WAL;');
    await client.$queryRawUnsafe('PRAGMA synchronous = NORMAL;');
    await client.$queryRawUnsafe('PRAGMA busy_timeout = 5000;');
    await client.$queryRawUnsafe('PRAGMA foreign_keys = ON;');
    globalForPrisma.sqliteConfigured = true;
  } catch (err) {
    console.warn('SQLite PRAGMA initialization warning:', err);
  }
}

// Backwards-compatibility alias for callers expecting ensureSqliteWal
export const ensureSqliteWal = configureSqliteConcurrency;

// Auto-configure SQLite high-concurrency mode on startup ONLY if using SQLite
const isSqlite = (process.env.DATABASE_URL || '').startsWith('file:');
if (isSqlite) {
  configureSqliteConcurrency(prisma);
}
