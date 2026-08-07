type DbUrlResolution = {
  url: string | null;
  source:
    | "database_url"
    | "supabase_db_url"
    | "supabase_parts"
    | "direct_url"
    | "none";
};

function encodePart(value: string): string {
  return encodeURIComponent(value);
}

export function resolveDatabaseUrl(): DbUrlResolution {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl) {
    return { url: databaseUrl, source: "database_url" };
  }

  const supabaseDbUrl = process.env.SUPABASE_DB_URL?.trim();
  if (supabaseDbUrl) {
    return { url: supabaseDbUrl, source: "supabase_db_url" };
  }

  const host = process.env.SUPABASE_DB_HOST?.trim();
  const user = process.env.SUPABASE_DB_USER?.trim();
  const password = process.env.SUPABASE_DB_PASSWORD?.trim();

  if (host && user && password) {
    const port = process.env.SUPABASE_DB_PORT?.trim() || "5432";
    const database = process.env.SUPABASE_DB_NAME?.trim() || "postgres";
    const sslMode = process.env.SUPABASE_DB_SSLMODE?.trim() || "require";

    const url = `postgresql://${encodePart(user)}:${encodePart(password)}@${host}:${port}/${database}?sslmode=${sslMode}`;
    return { url, source: "supabase_parts" };
  }

  return { url: null, source: "none" };
}

// Resolves the URL used for schema changes / migrations / seeding (Prisma CLI + seed script).
// Supabase (and most poolers) require a DIRECT/session-mode connection for DDL — the
// transaction pooler (pgbouncer, port 6543) breaks prepared statements and migrations.
// Prefer DIRECT_URL, falling back to the normal runtime URL when it isn't set.
export function resolveDirectDatabaseUrl(): DbUrlResolution {
  const directUrl = process.env.DIRECT_URL?.trim();
  if (directUrl) {
    return { url: directUrl, source: "direct_url" };
  }
  return resolveDatabaseUrl();
}

export function getDatabaseHost(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
