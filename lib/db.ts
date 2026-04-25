import * as PrismaClientPkg from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

const PrismaClient = (PrismaClientPkg as any).PrismaClient;

// Create the connection pool once
const rejectUnauthorized = process.env.NODE_ENV === 'production'
  ? process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false'
  : false;

const pool = new Pool({ 
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized } 
});

const adapter = new PrismaPg(pool);

// Export a single, reusable Prisma instance
export const db = new PrismaClient({ adapter });
