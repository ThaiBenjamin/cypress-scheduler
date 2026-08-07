import "dotenv/config";
import { defineConfig } from "@prisma/config";
import { resolveDirectDatabaseUrl } from "./lib/db-url";

// Prisma CLI commands (db push / migrate) run DDL, so use the DIRECT/session-mode
// connection (DIRECT_URL) rather than the transaction pooler.
const { url: resolvedDatabaseUrl } = resolveDirectDatabaseUrl();

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url:
      resolvedDatabaseUrl ||
      "postgresql://user:pass@localhost:5432/cypress_scheduler",
  },
});
