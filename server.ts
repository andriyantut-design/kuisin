import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import pg from "pg";
import dotenv from "dotenv";
import crypto from "crypto";

// Import Drizzle DB config and schemas with strict ESM extensions and files as required
import { db } from "./src/db/index.ts";
import { users as usersTable, quizzes as quizzesTable, quizHistory as quizHistoryTable } from "./src/db/schema.ts";
import { eq, desc } from "drizzle-orm";
import { adminAuth } from "./src/db/firebase-admin.ts";

// Load environment variables
dotenv.config();

const { Pool } = pg;
const app = express();
const PORT = 3000;

// Allow large uploads for document processing
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// Initialize Gemini SDK client (server-side only)
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
  httpOptions: {
    headers: {
      "User-Agent": "aistudio-build",
    },
  },
});

let dbPool: pg.Pool | null = null;
let dbConnected = false;
let dbError: string | null = null;

// Pool creator with lazy initialization
function getDbPool(customUrl?: string) {
  const connectionString = customUrl || process.env.DATABASE_URL;
  if (!connectionString) {
    dbConnected = false;
    dbError = "DATABASE_URL environment variable is not defined";
    return null;
  }

  try {
    // If resetting connection
    if (dbPool && customUrl) {
      dbPool.end().catch(console.error);
      dbPool = null;
    }

    if (!dbPool) {
      dbPool = new Pool({
        connectionString,
        connectionTimeoutMillis: 5000,
        // Common deployment Postgres instances like Neon, render, supabase require SSL
        ssl: connectionString.includes("localhost") || connectionString.includes("127.0.0.1")
          ? false
          : { rejectUnauthorized: false },
      });

      dbPool.on("error", (err: any) => {
        console.error("Database connection Pool error:", err);
        dbConnected = false;
        dbError = err.message || String(err);
      });
    }
    return dbPool;
  } catch (err: any) {
    dbPool = null;
    dbConnected = false;
    dbError = err.message || String(err);
    console.error("An error occurred creating pg Pool:", err);
    return null;
  }
}

// Resolve logged-in Firebase user and register in Cloud SQL
async function resolveUser(req: any) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  const token = authHeader.split("Bearer ")[1];
  try {
    if (!adminAuth) {
      console.warn("Skipping ID token verification because Firebase Admin SDK is not initialized.");
      return null;
    }
    const decodedToken = await adminAuth.verifyIdToken(token);
    if (decodedToken && decodedToken.uid && db) {
      const email = decodedToken.email || "anonymous@kuisin.com";
      const result = await db.insert(usersTable)
        .values({
          uid: decodedToken.uid,
          email: email,
        })
        .onConflictDoUpdate({
          target: usersTable.uid,
          set: {
            email: email,
          },
        })
        .returning();
      return result[0];
    }
  } catch (error) {
    console.error("Error resolving or saving Firebase user:", error);
  }
  return null;
}

// Check database connection and run migrations
async function testAndInitDatabase(customUrl?: string) {
  // If Cloud SQL parameters are present, we check Drizzle connection
  if (process.env.SQL_HOST && process.env.SQL_USER && process.env.SQL_DB_NAME) {
    try {
      if (db) {
        // Run a dummy check to verify connection
        await db.select().from(usersTable).limit(1);
        dbConnected = true;
        dbError = null;
        console.log("PostgreSQL via Cloud SQL Drizzle connected successfully.");
        return true;
      }
    } catch (err: any) {
      console.warn("Cloud SQL Drizzle connection check failed:", err.message);
    }
  }

  const pool = getDbPool(customUrl);
  if (!pool) {
    dbConnected = false;
    return false;
  }

  try {
    const client = await pool.connect();
    dbConnected = true;
    dbError = null;
    console.log("PostgreSQL Database connected successfully.");

    // Run table initializations
    await client.query(`
      CREATE TABLE IF NOT EXISTS quizzes (
        id VARCHAR(255) PRIMARY KEY,
        title TEXT NOT NULL,
        content_source TEXT,
        questions JSONB NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS quiz_history (
        id VARCHAR(255) PRIMARY KEY,
        quiz_id VARCHAR(255) NOT NULL,
        quiz_title TEXT NOT NULL,
        score INTEGER NOT NULL,
        total_questions INTEGER NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);

    client.release();
    return true;
  } catch (err: any) {
    dbConnected = false;
    dbError = err.message || String(err);
    console.error("Database initialization failed:", err);
    return false;
  }
}


// Initial DB check on bootstrap
testAndInitDatabase();

// --- API ENDPOINTS ---

// Check Database connection status
app.get("/api/db-status", (req, res) => {
  res.json({
    connected: dbConnected,
    error: dbError,
    usingFallback: !dbConnected,
  });
});

// Update or set database URL at runtime (supports users adding it in real time)
app.post("/api/reconnect", async (req, res) => {
  const { databaseUrl } = req.body;
  if (!databaseUrl) {
    return res.status(400).json({ success: false, error: "Database URL is required." });
  }

  console.log("Attempting reconnect with provided connection URL...");
  const success = await testAndInitDatabase(databaseUrl);
  if (success) {
    // Safely cache it in the process environment
    process.env.DATABASE_URL = databaseUrl;
    return res.json({
      success: true,
      message: "Database connected successfully and tables initialized!",
      status: { connected: dbConnected, error: null, usingFallback: false },
    });
  } else {
    return res.status(400).json({
      success: false,
      error: dbError || "Failed to establish a connection with the provided Postgres URL.",
      status: { connected: dbConnected, error: dbError, usingFallback: true },
    });
  }
});

// Generate quiz utilizing Gemini-3.5-flash
app.post("/api/quiz/generate", async (req, res) => {
  const { text, fileData, fileName, questionCount } = req.body;

  // Perform basic input validation
  if (!fileData && (!text || text.trim().length < 50)) {
    return res.status(400).json({
      error: "The provided study material is too short. Please provide at least 50 characters of text or paste your material.",
    });
  }

  try {
    const qCount = parseInt(questionCount, 10) || 5;

    // Build the parts for the Gemini request
    const contents: any[] = [];

    if (fileData) {
      // Direct binary inclusion of PDF or documents
      contents.push({
        inlineData: {
          mimeType: "application/pdf",
          data: fileData, // Base64 encoding
        },
      });
      contents.push(
        `Generate a fully customized single multiple-choice questions quiz based on the uploaded document. It must have exactly ${qCount} questions, each having precisely 4 options and exactly 1 correct index. Create a descriptive title.`
      );
    } else {
      contents.push(
        `Generate a fully customized single multiple-choice questions quiz based on the following study materials:\n\n${text}\n\nRequirements:\n- Generate exactly ${qCount} questions.\n- Provide exactly 4 options per question.\n- Provide the correct Option Index (numbered 0 to 3).\n- Provide a comprehensive step-by-step explanation for the correct answer.\n- Come up with a great relevant title based on the topics.`
      );
    }

    console.log(`Querying Gemini (gemini-3.5-flash) to generate ${qCount} questions...`);

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          description: "An object containing custom title and quiz questions.",
          properties: {
            title: {
              type: Type.STRING,
              description: "A tailored, relevant title for the quiz (max 6-8 words).",
            },
            questions: {
              type: Type.ARRAY,
              description: "Array of exactly N multiple choice questions.",
              items: {
                type: Type.OBJECT,
                properties: {
                  question: {
                    type: Type.STRING,
                    description: "The complete question text.",
                  },
                  options: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                    description: "Exactly 4 options.",
                  },
                  correctOptionIndex: {
                    type: Type.INTEGER,
                    description: "The index of the correct answer in options array (0 to 3).",
                  },
                  explanation: {
                    type: Type.STRING,
                    description: "Detailed description explaining why this option is correct.",
                  },
                },
                required: ["question", "options", "correctOptionIndex", "explanation"],
              },
            },
          },
          required: ["title", "questions"],
        },
      },
    });

    const outputText = response.text;
    if (!outputText) {
      throw new Error("No responses received from the AI. Please try again.");
    }

    // Parse the generated JSON safely
    const parsedData = JSON.parse(outputText.trim());

    const quizId = crypto.randomUUID();
    const quizResponse = {
      id: quizId,
      title: parsedData.title || "Lecture Quiz",
      contentSource: fileName || "Pasted Material",
      questions: parsedData.questions,
      createdAt: new Date().toISOString(),
    };

    // Attempt database persistence using Drizzle if available, otherwise raw pool fallback
    try {
      const user = await resolveUser(req);
      if (db) {
        await db.insert(quizzesTable)
          .values({
            id: quizResponse.id,
            userId: user ? user.id : null,
            title: quizResponse.title,
            contentSource: quizResponse.contentSource,
            questions: quizResponse.questions,
            createdAt: new Date(quizResponse.createdAt),
          });
        console.log(`Quiz '${quizResponse.title}' successfully persisted via Drizzle.`);
      } else {
        const pool = getDbPool();
        if (dbConnected && pool) {
          await pool.query(
            "INSERT INTO quizzes (id, title, content_source, questions, created_at) VALUES ($1, $2, $3, $4, $5)",
            [
              quizResponse.id,
              quizResponse.title,
              quizResponse.contentSource,
              JSON.stringify(quizResponse.questions),
              quizResponse.createdAt,
            ]
          );
          console.log(`Quiz '${quizResponse.title}' successfully persisted via fallback pool.`);
        }
      }
    } catch (dbErr) {
      console.error("Failed to persist quiz record to database:", dbErr);
    }

    return res.json({
      success: true,
      quiz: quizResponse,
      dbSynced: dbConnected,
    });
  } catch (error: any) {
    console.error("Gemini quiz generation error:", error);
    return res.status(500).json({
      error: "Quiz generation failed. Please try a different document or check your API configuration.",
      details: error.message || String(error),
    });
  }
});

// Fetch historical quizzes from Database (re-routes if DB is offline)
app.get("/api/quiz/history", async (req, res) => {
  try {
    const user = await resolveUser(req);
    if (db) {
      let results;
      if (user) {
        // Fetch only this user's records
        results = await db.select()
          .from(quizHistoryTable)
          .where(eq(quizHistoryTable.userId, user.id))
          .orderBy(desc(quizHistoryTable.createdAt));
      } else {
        // Fetch anonymous records (where user_id is null)
        results = await db.select()
          .from(quizHistoryTable)
          .orderBy(desc(quizHistoryTable.createdAt));
      }

      return res.json({
        success: true,
        history: results.map(row => ({
          id: row.id,
          quizId: row.quizId,
          quizTitle: row.quizTitle,
          score: row.score,
          totalQuestions: row.totalQuestions,
          createdAt: row.createdAt?.toISOString() || new Date().toISOString(),
        })),
        dbConnected: true,
      });
    }

    const pool = getDbPool();
    if (dbConnected && pool) {
      const result = await pool.query(
        'SELECT id, quiz_id as "quizId", quiz_title as "quizTitle", score, total_questions as "totalQuestions", created_at as "createdAt" FROM quiz_history ORDER BY created_at DESC'
      );
      return res.json({
        success: true,
        history: result.rows,
        dbConnected: true,
      });
    }
  } catch (err: any) {
    console.error("Database query of history failed:", err);
    return res.status(500).json({
      error: "Failed to load quiz history from database.",
      details: err.message,
      dbConnected: false,
    });
  }

  return res.json({
    success: true,
    history: [],
    dbConnected: false,
    message: "Utilizing Client State (DB link offline).",
  });
});

// Save Quiz History Score
app.post("/api/quiz/history", async (req, res) => {
  const { id, quizId, quizTitle, score, totalQuestions, createdAt } = req.body;

  const entryId = id || crypto.randomUUID();
  const dateObj = createdAt ? new Date(createdAt) : new Date();

  try {
    const user = await resolveUser(req);
    if (db) {
      await db.insert(quizHistoryTable)
        .values({
          id: entryId,
          userId: user ? user.id : null,
          quizId,
          quizTitle,
          score,
          totalQuestions,
          createdAt: dateObj,
        });

      return res.json({
        success: true,
        savedToDb: true,
      });
    }

    const pool = getDbPool();
    if (dbConnected && pool) {
      await pool.query(
        "INSERT INTO quiz_history (id, quiz_id, quiz_title, score, total_questions, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
        [entryId, quizId, quizTitle, score, totalQuestions, dateObj.toISOString()]
      );
      return res.json({
        success: true,
        savedToDb: true,
      });
    }
  } catch (err: any) {
    console.error("Saving score failed in database:", err);
    return res.status(500).json({
      error: "Failed to persist score to Database.",
      details: err.message,
    });
  }

  return res.json({
    success: true,
    savedToDb: false,
    message: "Saved locally inside browser storage.",
  });
});

// Fetch Single Saved Quiz by ID
app.get("/api/quiz/:id", async (req, res) => {
  const { id } = req.params;
  try {
    if (db) {
      const results = await db.select()
        .from(quizzesTable)
        .where(eq(quizzesTable.id, id))
        .limit(1);

      if (results.length > 0) {
        const row = results[0];
        return res.json({
          success: true,
          quiz: {
            id: row.id,
            title: row.title,
            contentSource: row.contentSource,
            questions: row.questions,
            createdAt: row.createdAt?.toISOString() || new Date().toISOString(),
          },
        });
      }
    }

    const pool = getDbPool();
    if (dbConnected && pool) {
      const result = await pool.query(
        'SELECT id, title, content_source as "contentSource", questions, created_at as "createdAt" FROM quizzes WHERE id = $1',
        [id]
      );
      if (result.rows.length > 0) {
        const row = result.rows[0];
        return res.json({
          success: true,
          quiz: {
            id: row.id,
            title: row.title,
            contentSource: row.contentSource,
            questions: typeof row.questions === "string" ? JSON.parse(row.questions) : row.questions,
            createdAt: row.createdAt,
          },
        });
      }
    }
  } catch (err: any) {
    console.error(`Failed to fetch quiz ID ${id}:`, err);
    return res.status(500).json({ error: "Database reading failed." });
  }

  return res.status(404).json({ error: "Quiz not found." });
});

// --- VITE MIDDLEWARE SETUP ---

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    // In Express 4, use app.get('*', ...)
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server is running internally on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});
