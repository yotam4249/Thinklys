
// src/routes/api.ts
import express from "express";
import { authRouter } from "./auth.routes";
import { chatRouter } from "./chat.routes";
import { aiQaRouter } from "./ai.qa.route";
import { aiQuizRouter } from "./ai.quiz.route";
import { fileRouter } from "./files.routes";

export const apiRouter = express.Router();

apiRouter.use((req, _res, next) => {
  console.log(`[API] → ${req.method} ${req.originalUrl}`);
  next();
});
apiRouter.use("/files", fileRouter); 

apiRouter.use("/auth", authRouter);
apiRouter.use("/chat", chatRouter);

// AI (cache-first endpoints)
apiRouter.use("/ai", aiQaRouter);    // POST /api/ai/qa
apiRouter.use("/ai", aiQuizRouter);  // POST /api/ai/quiz

apiRouter.get("/health", (_req, res) => {
  console.log("[API] /health OK");
  res.json({ ok: true });
});
