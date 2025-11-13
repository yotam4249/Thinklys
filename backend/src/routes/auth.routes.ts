import { Router } from "express";
import { AuthController } from "../controllers/auth.controller";
import { authMiddleware } from "../middleware/auth.middleware";

export const authRouter = Router();

authRouter.post("/register", AuthController.register);
authRouter.post("/login", AuthController.login);
authRouter.post("/refresh", AuthController.refresh);
authRouter.post("/logout", AuthController.logout);
authRouter.get("/me", authMiddleware, AuthController.me);
authRouter.put("/profile", authMiddleware, AuthController.updateProfile);
authRouter.put("/password", authMiddleware, AuthController.updatePassword);
authRouter.get("/user/:userId", authMiddleware, AuthController.getUserProfile);
