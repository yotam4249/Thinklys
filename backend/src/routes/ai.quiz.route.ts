// src/routes/ai.quiz.route.ts
import express from "express";
import { quizGenerate, quizSaveResult } from "../controllers/ai.quiz.controller";
import { authMiddleware } from "../middleware/auth.middleware";

export const aiQuizRouter = express.Router();

aiQuizRouter.post("/quiz", (req, res, next) => {
  console.log("[ROUTE] POST /api/ai/quiz body:", req.body);
  next();
}, quizGenerate);

aiQuizRouter.post("/quiz/result", authMiddleware, quizSaveResult);
