// src/routes/ai.qa.route.ts
import express from "express";
import { qaAnswer } from "../controllers/ai.qa.controller";

export const aiQaRouter = express.Router();

aiQaRouter.post("/qa", (req, res, next) => {
  console.log("[ROUTE] POST /api/ai/qa body:", req.body);
  next();
}, qaAnswer);
