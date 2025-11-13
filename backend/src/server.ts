import express, { type Express } from "express";
import cors from "cors";
import mongoose from "mongoose";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { apiRouter } from "./routes/api";

export async function connectMongo(uri: string, dbName: string) {
  const conn = mongoose.connection;

  conn.on("connected", () => {
    console.log(`Mongo connected`);
  });

  conn.on("error", (e) => console.error("[mongo] error:", e));
  conn.on("disconnected", () => console.log("Mongo disconnected"));

  await mongoose.connect(uri, {
    dbName,
    serverSelectionTimeoutMS: 10_000,
    socketTimeoutMS: 45_000,
    maxPoolSize: 20,
  } as any);

  if (!conn.db) return;
  await conn.db.admin().command({ ping: 1 });
  console.log("Mongo ping OK");
}

export async function disconnectMongo() {
  await mongoose.disconnect();
}

export function createApp(): Express {
  const app = express();
  const isProd = process.env.NODE_ENV === "production";

  // Trust proxy (needed on Render for secure cookies)
  app.set("trust proxy", true);

  // Basic security headers
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
    })
  );

  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // ---------- SECURE CORS SETUP ----------
  const allowedOrigins: (string | RegExp)[] = [
    "http://localhost:5173",
    "http://localhost:3000",
    "https://thinkly-psi.vercel.app", // your production site
    /\.vercel\.app$/                  // allow all Vercel preview URLs
  ];

  app.use(
    cors({
      origin(origin, cb) {
        if (!origin) return cb(null, true); // allow server-to-server/curl
        const ok = allowedOrigins.some(rule =>
          typeof rule === "string" ? rule === origin : rule.test(origin)
        );
        if (ok) return cb(null, true);
        console.warn(`❌ CORS blocked: ${origin}`);
        return cb(new Error(`CORS blocked: ${origin}`));
      },
      credentials: true, // <-- allow cookies to be sent
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    })
  );

  // ---------- Optional dev request logger ----------
  if (!isProd) {
    app.use((req, _res, next) => {
      console.log(`[${req.method}] ${req.originalUrl}`);
      next();
    });
  }

  // ---------- Health checks ----------
  app.get("/", (_req, res) => res.send("OK"));
  app.get("/health", (_req, res) => res.json({ ok: true }));

  // ---------- Main API ----------
  app.use("/api", apiRouter);

  return app;
}
