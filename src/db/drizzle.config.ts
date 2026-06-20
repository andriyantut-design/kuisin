import { defineConfig } from "drizzle-kit";
import * as dotenv from "dotenv";

// Load environment variables
dotenv.config();

const sqlHost = process.env.SQL_HOST || "";
const sqlDbName = process.env.SQL_DB_NAME || "";
const user = process.env.SQL_ADMIN_USER || "";
const password = process.env.SQL_ADMIN_PASSWORD || "";

if (!sqlHost || !sqlDbName || !user || !password) {
  console.warn("WARNING: Cloud SQL admin credentials are not fully set in the current environment.");
}

console.log(`Using admin user: ${user || "not-configured"} to connect to database.`);

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle", // Output directory for migrations
  dialect: "postgresql",
  schemaFilter: ["public"],
  dbCredentials: {
    host: sqlHost,
    user: user,
    password: password,
    database: sqlDbName,
    ssl: false, // Typically false when connecting via local Unix Proxy
  },
  verbose: true,
});
