type DbUrlResolution = {
  url: string | null;
  source:
    | "database_url"
    | "supabase_db_url"
    | "supabase_parts"
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

export function getDatabaseHost(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
