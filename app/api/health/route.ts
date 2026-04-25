import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDatabaseHost, resolveDatabaseUrl } from "@/lib/db-url";

export const dynamic = "force-dynamic";

export async function GET() {
  const { url: resolvedDatabaseUrl, source: databaseUrlSource } = resolveDatabaseUrl();
  const databaseHost = getDatabaseHost(resolvedDatabaseUrl);

  const startedAt = Date.now();

  let dbStatus: {
    ok: boolean;
    latencyMs: number;
    error?: {
      name: string;
      message: string;
      code?: string;
    };
  };

  try {
    await db.$queryRaw`SELECT 1`;
    dbStatus = {
      ok: true,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error: unknown) {
    const normalizedError = error as { name?: string; message?: string; code?: string };
    dbStatus = {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: {
        name: normalizedError?.name || "DatabaseError",
        message: normalizedError?.message || "Unknown database connection error.",
        code: normalizedError?.code,
      },
    };
  }

  const statusCode = dbStatus.ok ? 200 : 503;

  return NextResponse.json({
    ok: dbStatus.ok,
    service: "cypress-scheduler",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    databaseUrlSet: Boolean(resolvedDatabaseUrl),
    databaseUrlSource,
    databaseHost,
    database: dbStatus,
  }, { status: statusCode, headers: { "Cache-Control": "no-store" } });
}
