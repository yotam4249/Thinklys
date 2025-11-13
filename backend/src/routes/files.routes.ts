// src/routes/file.routes.ts
import { Router } from "express";
import { FilesController } from "../controllers/files.controller";
import { authMiddleware } from "../middleware/auth.middleware";

export const fileRouter = Router();

// allow presign for unauthenticated new user registration images, authenticated for everything else
fileRouter.post("/s3/presign-upload", (req, res, next) => {
  const prefix = req.body?.prefix;
  if (typeof prefix === "string" && prefix.startsWith("users/new")) {
    return FilesController.presignUpload(req, res);
  }
  // For chat/images and other prefixes, require authentication
  return authMiddleware(req, res, next);
}, FilesController.presignUpload);

// GET presign-get can stay public
fileRouter.get("/s3/presign-get", FilesController.presignGet);
