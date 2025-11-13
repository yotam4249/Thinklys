import { Request, Response, NextFunction } from "express";
import { verifyAccess } from "../services/auth.service";
import { TokenExpiredError, JsonWebTokenError, NotBeforeError } from "jsonwebtoken";

export function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ code: "NO_TOKEN" });
  }
  const token = header.slice("Bearer ".length).trim();
  try {
    const payload = verifyAccess(token); 
    (req as any).user = { id: payload.sub, username: payload.username };
    return next();
  } catch (err) {
    if (err instanceof TokenExpiredError) return res.status(401).json({ code: "ACCESS_TOKEN_EXPIRED" });
    if (err instanceof NotBeforeError) return res.status(401).json({ code: "TOKEN_NOT_ACTIVE" });
    if (err instanceof JsonWebTokenError) return res.status(401).json({ code: "INVALID_TOKEN" });
    return res.status(401).json({ code: "UNAUTHORIZED" });
  }
}
