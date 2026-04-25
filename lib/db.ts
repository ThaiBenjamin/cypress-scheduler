import * as PrismaClientPkg from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { getDatabaseHost, resolveDatabaseUrl } from './db-url';

const PrismaClientCtor = (PrismaClientPkg as any).PrismaClient;

const { url: resolvedDatabaseUrl } = resolveDatabaseUrl();
const databaseHost = getDatabaseHost(resolvedDatabaseUrl);
const isSupabaseHost = (databaseHost || '').endsWith('.supabase.co');

// Create the connection pool once
const rejectUnauthorized = process.env.DB_SSL_REJECT_UNAUTHORIZED === 'false'
  ? false
  : process.env.NODE_ENV === 'production' || isSupabaseHost;

const pool = new Pool({ 
  connectionString: resolvedDatabaseUrl || undefined,
  ssl: { rejectUnauthorized } 
});

const adapter = new PrismaPg(pool);

// Export a single, reusable Prisma instance
export const db = new PrismaClientCtor({ adapter });
