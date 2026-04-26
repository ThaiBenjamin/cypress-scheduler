import "dotenv/config";
import { defineConfig } from "@prisma/config";
import { resolveDatabaseUrl } from "./lib/db-url";

const { url: resolvedDatabaseUrl } = resolveDatabaseUrl();

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url:
      resolvedDatabaseUrl ||
      "postgresql://user:pass@localhost:5432/cypress_scheduler",
  },
});
