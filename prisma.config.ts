import { defineConfig } from "prisma/config";

// Step 04A is code generation/validation only. Deliberately no CLI datasource
// URL: migrate, db push, pull, and Studio must not connect to any database.
// Approved migrations use prisma.migrate.config.ts with the dedicated direct
// URL injected by a reviewed caller. Ordinary generation stays offline.
export default defineConfig({ schema: "prisma/schema.prisma" });
