import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.ts";

const { Pool } = pg;

// Function to create a new connection pool using the Object Method as strictly required.
export const createPool = () => {
  // Check if we have the Cloud SQL environment variables provided at runtime
  if (process.env.SQL_HOST && process.env.SQL_USER && process.env.SQL_DB_NAME) {
    console.log("Initializing Cloud SQL connection pool via Object Method...");
    return new Pool({
      host: process.env.SQL_HOST,
      user: process.env.SQL_USER,
      password: process.env.SQL_PASSWORD,
      database: process.env.SQL_DB_NAME,
      connectionTimeoutMillis: 15000,
      // The socket connections on Cloud Run do not require SSL as they connect locally
      ssl: false,
    });
  }

  // Fallback to custom user DATABASE_URL connection string if Cloud SQL is not provisioned
  if (process.env.DATABASE_URL) {
    console.log("Initializing custom database connection using DATABASE_URL...");
    return new Pool({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 15000,
      ssl: process.env.DATABASE_URL.includes("localhost") || process.env.DATABASE_URL.includes("127.0.0.1")
        ? false
        : { rejectUnauthorized: false },
    });
  }

  console.warn("No database connection environment variables defined yet.");
  return null;
};

// Create a pool instance
const pool = createPool();

if (pool) {
  // Prevent unhandled pool-level errors from crashing the application
  pool.on("error", (err) => {
    console.error("Unexpected error on idle SQL pool client:", err);
  });
}

// Initialize Drizzle with the pool and schema (using type cast if pool is null for safe initialization)
export const db = pool ? drizzle(pool, { schema }) : null;
