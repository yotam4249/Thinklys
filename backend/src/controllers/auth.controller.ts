// import { Request, Response } from "express";
// import { UserModel } from "../models/user.model";
// import {
//   comparePassword,
//   hashPassword,
//   verifyRefresh,
//   signAccess,
//   issueTokens,
//   rotateRefresh,
//   revokeRefresh,
// } from "../services/auth.service";
// import { getPresignedGetUrl } from "../services/s3.service";

// export class AuthController {
//   static async register(req: Request, res: Response) {
//     try {
//       let {
//         username,
//         password,
//         dateOfBirth,
//         gender,
//         profileImage, // S3 key sent from client after presigned PUT
//       } = req.body ?? {};

//       if (!username || !password) {
//         return res
//           .status(400)
//           .json({ code: "BAD REQUEST", message: "Username or password needed" });
//       }
//       username = String(username).trim().toLowerCase();

//       const allowedGenders = ["male", "female", "other", "prefer_not_to_say"];
//       if (gender && !allowedGenders.includes(gender)) {
//         return res.status(400).json({ code: "INVALID_GENDER" });
//       }

//       let birthDate: Date | undefined;
//       if (dateOfBirth) {
//         const parsed = new Date(dateOfBirth);
//         if (isNaN(parsed.getTime())) {
//           return res.status(400).json({ code: "INVALID_DATE_OF_BIRTH" });
//         }
//         const age = Math.floor(
//           (Date.now() - parsed.getTime()) / (365.25 * 24 * 3600 * 1000)
//         );
//         if (age < 16) return res.status(400).json({ code: "AGE_TOO_YOUNG" });
//         birthDate = parsed;
//       }

//       const exist = await UserModel.findOne({ username });
//       if (exist) return res.status(409).json({ code: "USERNAME_EXISTS" });

//       const hashed = await hashPassword(password);
//       const user = await UserModel.create({
//         username,
//         password: hashed,
//         dateOfBirth: birthDate,
//         gender,
//         profileImage: profileImage || null, // store S3 key
//       });

//       const tokens = await issueTokens(user);

//       const profileImageUrl = user.profileImage
//         ? await getPresignedGetUrl(user.profileImage)
//         : null;

//       return res.status(201).json({
//         user: {
//           id: user.id,
//           username: user.username,
//           dateOfBirth: user.dateOfBirth,
//           gender: user.gender,
//           profileImage: user.profileImage ?? null, // S3 key
//           profileImageUrl, // ephemeral GET URL
//           quizHistory: user.quizHistory ?? [],
//         },
//         ...tokens,
//       });
//     } catch (err) {
//       console.error("register error:", err);
//       return res.status(500).json({ code: "SERVER_ERROR" });
//     }
//   }

//   static async login(req: Request, res: Response) {
//     try {
//       let { username, password } = req.body ?? {};
//       if (!username || !password) {
//         return res
//           .status(400)
//           .json({ code: "BAD REQUEST", message: "Username or password needed" });
//       }
//       username = String(username).trim().toLocaleLowerCase();

//       const user = await UserModel.findOne({ username });
//       if (!user) {
//         return res.status(401).json({ code: "INVALID CREDENTIALS" });
//       }

//       const ok = await comparePassword(password, user.password);
//       if (!ok) {
//         return res.status(401).json({ code: "INVALID CREDENTIALS" });
//       }

//       const tokens = await issueTokens(user);
//       const profileImageUrl = user.profileImage
//         ? await getPresignedGetUrl(user.profileImage)
//         : null;

//       return res.status(201).json({
//         user: {
//           id: user.id,
//           username: user.username,
//           dateOfBirth: user.dateOfBirth,
//           gender: user.gender,
//           profileImage: user.profileImage ?? null,
//           profileImageUrl,
//           quizHistory: user.quizHistory ?? [],
//         },
//         ...tokens,
//       });
//     } catch (err) {
//       console.error("login error:", err);
//       return res.status(500).json({ code: "SERVER_ERROR" });
//     }
//   }

//   static async refresh(req: Request, res: Response) {
//     try {
//       const refresh = req.body?.refreshToken;
//       if (!refresh) return res.status(401).json({ code: "NO_REFRESH" });

//       let payload;
//       try {
//         payload = verifyRefresh(refresh);
//       } catch {
//         return res.status(401).json({ code: "REFRESH_INVALID" });
//       }

//       const user = await UserModel.findById(payload.sub);
//       if (!user || !user.refreshTokens.includes(refresh)) {
//         return res.status(401).json({ code: "REFRESH_REVOKED" });
//       }

//       const newRefresh = await rotateRefresh(user.id, refresh);
//       const newAccess = signAccess(user);
//       return res.json({ accessToken: newAccess, refreshToken: newRefresh });
//     } catch (e) {
//       console.error("refresh error:", e);
//       return res.status(500).json({ code: "SERVER_ERROR" });
//     }
//   }

//   static async logout(req: Request, res: Response) {
//     try {
//       const refresh = req.body?.refreshToken;
//       if (!refresh) return res.status(400).json({ code: "NO_REFRESH" });

//       let sub: string | null = null;
//       try {
//         const p = verifyRefresh(refresh);
//         sub = p.sub;
//       } catch {}
//       if (sub) await revokeRefresh(sub, refresh);

//       return res.json({ ok: true });
//     } catch (e) {
//       console.error("logout error:", e);
//       return res.status(500).json({ code: "SERVER_ERROR" });
//     }
//   }

//   static async me(req: Request, res: Response) {
//     const userId = (req as any)?.user?.id;
//     if (!userId) return res.status(401).json({ code: "UNAUTHORIZED" });

//     const user = await UserModel.findById(userId).select("_id username profileImage dateOfBirth gender quizHistory");
//     if (!user) return res.status(404).json({ code: "NOT_FOUND" });

//     const profileImageUrl = user.profileImage
//       ? await getPresignedGetUrl(user.profileImage)
//       : null;

//     return res.json({
//       user: {
//         id: user.id,
//         username: user.username,
//         dateOfBirth: user.dateOfBirth,
//         gender: user.gender,
//         profileImage: user.profileImage ?? null,
//         profileImageUrl,
//         quizHistory: user.quizHistory ?? [],
//       },
//     });
//   }

//   static async updateProfile(req: Request, res: Response) {
//     try {
//       const userId = (req as any)?.user?.id;
//       if (!userId) return res.status(401).json({ code: "UNAUTHORIZED" });

//       const { dateOfBirth, gender, profileImage } = req.body ?? {};

//       const user = await UserModel.findById(userId);
//       if (!user) return res.status(404).json({ code: "NOT_FOUND" });

//       // Validate gender if provided
//       const allowedGenders = ["male", "female", "other", "prefer_not_to_say"];
//       if (gender !== undefined && gender !== null && !allowedGenders.includes(gender)) {
//         return res.status(400).json({ code: "INVALID_GENDER" });
//       }

//       // Validate and update date of birth if provided
//       if (dateOfBirth !== undefined) {
//         if (dateOfBirth === null || dateOfBirth === "") {
//           user.dateOfBirth = undefined;
//         } else {
//           const parsed = new Date(dateOfBirth);
//           if (isNaN(parsed.getTime())) {
//             return res.status(400).json({ code: "INVALID_DATE_OF_BIRTH" });
//           }
//           const age = Math.floor(
//             (Date.now() - parsed.getTime()) / (365.25 * 24 * 3600 * 1000)
//           );
//           if (age < 16) return res.status(400).json({ code: "AGE_TOO_YOUNG" });
//           user.dateOfBirth = parsed;
//         }
//       }

//       // Update gender if provided
//       if (gender !== undefined) {
//         user.gender = gender || undefined;
//       }

//       // Update profile image if provided
//       if (profileImage !== undefined) {
//         user.profileImage = profileImage || null;
//       }

//       await user.save();

//       const profileImageUrl = user.profileImage
//         ? await getPresignedGetUrl(user.profileImage)
//         : null;

//       return res.json({
//         user: {
//           id: user.id,
//           username: user.username,
//           dateOfBirth: user.dateOfBirth,
//           gender: user.gender,
//           profileImage: user.profileImage ?? null,
//           profileImageUrl,
//           quizHistory: user.quizHistory ?? [],
//         },
//       });
//     } catch (err) {
//       console.error("updateProfile error:", err);
//       return res.status(500).json({ code: "SERVER_ERROR" });
//     }
//   }

//   static async updatePassword(req: Request, res: Response) {
//     try {
//       const userId = (req as any)?.user?.id;
//       if (!userId) return res.status(401).json({ code: "UNAUTHORIZED" });

//       const { currentPassword, newPassword } = req.body ?? {};

//       if (!currentPassword || !newPassword) {
//         return res.status(400).json({ code: "BAD REQUEST", message: "Current password and new password required" });
//       }

//       if (newPassword.length < 6) {
//         return res.status(400).json({ code: "PASSWORD_TOO_SHORT" });
//       }

//       const user = await UserModel.findById(userId);
//       if (!user) return res.status(404).json({ code: "NOT_FOUND" });

//       // Verify current password
//       const isValidPassword = await comparePassword(currentPassword, user.password);
//       if (!isValidPassword) {
//         return res.status(401).json({ code: "INVALID_PASSWORD" });
//       }

//       // Update password
//       const hashed = await hashPassword(newPassword);
//       user.password = hashed;
//       await user.save();

//       return res.json({ success: true });
//     } catch (err) {
//       console.error("updatePassword error:", err);
//       return res.status(500).json({ code: "SERVER_ERROR" });
//     }
//   }

//   static async getUserProfile(req: Request, res: Response) {
//     try {
//       const { userId } = req.params;
//       if (!userId) return res.status(400).json({ code: "BAD_REQUEST", message: "User ID required" });

//       const user = await UserModel.findById(userId).select("_id username profileImage dateOfBirth gender quizHistory");
//       if (!user) return res.status(404).json({ code: "NOT_FOUND" });

//       const profileImageUrl = user.profileImage
//         ? await getPresignedGetUrl(user.profileImage)
//         : null;

//       return res.json({
//         user: {
//           id: user.id,
//           username: user.username,
//           dateOfBirth: user.dateOfBirth,
//           gender: user.gender,
//           profileImage: user.profileImage ?? null,
//           profileImageUrl,
//           quizHistory: user.quizHistory ?? [],
//         },
//       });
//     } catch (err) {
//       console.error("getUserProfile error:", err);
//       return res.status(500).json({ code: "SERVER_ERROR" });
//     }
//   }
// }
import { Request, Response } from "express";
import { UserModel } from "../models/user.model";
import {
  comparePassword,
  hashPassword,
  verifyRefresh,
  signAccess,
  issueTokens,
  rotateRefresh,
  revokeRefresh,
} from "../services/auth.service";
import { getPresignedGetUrl } from "../services/s3.service";
import {
  REFRESH_COOKIE_NAME,
  refreshCookieOptions,
  refreshCookieClear,
} from "../utils/cookie";

export class AuthController {
  static async register(req: Request, res: Response) {
    try {
      let {
        username,
        password,
        dateOfBirth,
        gender,
        profileImage, // S3 key sent from client after presigned PUT
      } = req.body ?? {};

      if (!username || !password) {
        return res
          .status(400)
          .json({ code: "BAD REQUEST", message: "Username or password needed" });
      }
      username = String(username).trim().toLowerCase();

      const allowedGenders = ["male", "female", "other", "prefer_not_to_say"];
      if (gender && !allowedGenders.includes(gender)) {
        return res.status(400).json({ code: "INVALID_GENDER" });
      }

      let birthDate: Date | undefined;
      if (dateOfBirth) {
        const parsed = new Date(dateOfBirth);
        if (isNaN(parsed.getTime())) {
          return res.status(400).json({ code: "INVALID_DATE_OF_BIRTH" });
        }
        const age = Math.floor(
          (Date.now() - parsed.getTime()) / (365.25 * 24 * 3600 * 1000)
        );
        if (age < 16) return res.status(400).json({ code: "AGE_TOO_YOUNG" });
        birthDate = parsed;
      }

      const exist = await UserModel.findOne({ username });
      if (exist) return res.status(409).json({ code: "USERNAME_EXISTS" });

      const hashed = await hashPassword(password);
      const user = await UserModel.create({
        username,
        password: hashed,
        dateOfBirth: birthDate,
        gender,
        profileImage: profileImage || null, // store S3 key
      });

      // Issue tokens
      const { accessToken, refreshToken } = await issueTokens(user);

      // Set secure HTTP-only cookie with the refresh token
      res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions);

      const profileImageUrl = user.profileImage
        ? await getPresignedGetUrl(user.profileImage)
        : null;

      // NOTE: we still return refreshToken for backward-compat (mobile).
      // For stricter security on web, you may remove it after clients migrate.
      return res.status(201).json({
        user: {
          id: user.id,
          username: user.username,
          dateOfBirth: user.dateOfBirth,
          gender: user.gender,
          profileImage: user.profileImage ?? null, // S3 key
          profileImageUrl, // ephemeral GET URL
          quizHistory: user.quizHistory ?? [],
        },
        accessToken,
        refreshToken, // optional to keep for mobile clients
      });
    } catch (err) {
      console.error("register error:", err);
      return res.status(500).json({ code: "SERVER_ERROR" });
    }
  }

  static async login(req: Request, res: Response) {
    try {
      let { username, password } = req.body ?? {};
      if (!username || !password) {
        return res
          .status(400)
          .json({ code: "BAD REQUEST", message: "Username or password needed" });
      }
      username = String(username).trim().toLocaleLowerCase();

      const user = await UserModel.findOne({ username });
      if (!user) {
        return res.status(401).json({ code: "INVALID CREDENTIALS" });
      }

      const ok = await comparePassword(password, user.password);
      if (!ok) {
        return res.status(401).json({ code: "INVALID CREDENTIALS" });
      }

      const { accessToken, refreshToken } = await issueTokens(user);

      // Set refresh cookie
      res.cookie(REFRESH_COOKIE_NAME, refreshToken, refreshCookieOptions);

      const profileImageUrl = user.profileImage
        ? await getPresignedGetUrl(user.profileImage)
        : null;

      // Again, keep refreshToken in body for mobile until you move them to cookies
      return res.status(200).json({
        user: {
          id: user.id,
          username: user.username,
          dateOfBirth: user.dateOfBirth,
          gender: user.gender,
          profileImage: user.profileImage ?? null,
          profileImageUrl,
          quizHistory: user.quizHistory ?? [],
        },
        accessToken,
        refreshToken, // optional
      });
    } catch (err) {
      console.error("login error:", err);
      return res.status(500).json({ code: "SERVER_ERROR" });
    }
  }

  static async refresh(req: Request, res: Response) {
    try {
      // Prefer cookie (browser). Fallback to body (mobile/legacy).
      const cookieToken = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
      const bodyToken = req.body?.refreshToken as string | undefined;
      const refresh = cookieToken ?? bodyToken;

      if (!refresh) return res.status(401).json({ code: "NO_REFRESH" });

      let payload;
      try {
        payload = verifyRefresh(refresh);
      } catch {
        return res.status(401).json({ code: "REFRESH_INVALID" });
      }

      const user = await UserModel.findById(payload.sub);
      if (!user || !user.refreshTokens.includes(refresh)) {
        return res.status(401).json({ code: "REFRESH_REVOKED" });
      }

      // Rotate refresh and set new cookie
      const newRefresh = await rotateRefresh(user.id, refresh);
      res.cookie(REFRESH_COOKIE_NAME, newRefresh, refreshCookieOptions);

      const newAccess = signAccess(user);

      // Return new access; include refresh for mobile/legacy if you like
      return res.json({ accessToken: newAccess, refreshToken: newRefresh });
    } catch (e) {
      console.error("refresh error:", e);
      return res.status(500).json({ code: "SERVER_ERROR" });
    }
  }

  static async logout(req: Request, res: Response) {
    try {
      // Accept either cookie or body for refresh identification
      const cookieToken = req.cookies?.[REFRESH_COOKIE_NAME] as string | undefined;
      const bodyToken = req.body?.refreshToken as string | undefined;
      const refresh = cookieToken ?? bodyToken;

      if (!refresh) {
        // Still clear cookie so browser clients get logged out
        res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieClear);
        return res.status(400).json({ code: "NO_REFRESH" });
      }

      let sub: string | null = null;
      try {
        const p = verifyRefresh(refresh);
        sub = p.sub;
      } catch {}

      if (sub) await revokeRefresh(sub, refresh);

      // Clear cookie
      res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieClear);
      return res.json({ ok: true });
    } catch (e) {
      console.error("logout error:", e);
      return res.status(500).json({ code: "SERVER_ERROR" });
    }
  }

  static async me(req: Request, res: Response) {
    const userId = (req as any)?.user?.id;
    if (!userId) return res.status(401).json({ code: "UNAUTHORIZED" });

    const user = await UserModel.findById(userId).select(
      "_id username profileImage dateOfBirth gender quizHistory"
    );
    if (!user) return res.status(404).json({ code: "NOT_FOUND" });

    const profileImageUrl = user.profileImage
      ? await getPresignedGetUrl(user.profileImage)
      : null;

    return res.json({
      user: {
        id: user.id,
        username: user.username,
        dateOfBirth: user.dateOfBirth,
        gender: user.gender,
        profileImage: user.profileImage ?? null,
        profileImageUrl,
        quizHistory: user.quizHistory ?? [],
      },
    });
  }

  static async updateProfile(req: Request, res: Response) {
    try {
      const userId = (req as any)?.user?.id;
      if (!userId) return res.status(401).json({ code: "UNAUTHORIZED" });

      const { dateOfBirth, gender, profileImage } = req.body ?? {};

      const user = await UserModel.findById(userId);
      if (!user) return res.status(404).json({ code: "NOT_FOUND" });

      const allowedGenders = ["male", "female", "other", "prefer_not_to_say"];
      if (gender !== undefined && gender !== null && !allowedGenders.includes(gender)) {
        return res.status(400).json({ code: "INVALID_GENDER" });
      }

      if (dateOfBirth !== undefined) {
        if (dateOfBirth === null || dateOfBirth === "") {
          user.dateOfBirth = undefined;
        } else {
          const parsed = new Date(dateOfBirth);
          if (isNaN(parsed.getTime())) {
            return res.status(400).json({ code: "INVALID_DATE_OF_BIRTH" });
          }
          const age = Math.floor(
            (Date.now() - parsed.getTime()) / (365.25 * 24 * 3600 * 1000)
          );
          if (age < 16) return res.status(400).json({ code: "AGE_TOO_YOUNG" });
          user.dateOfBirth = parsed;
        }
      }

      if (gender !== undefined) user.gender = gender || undefined;
      if (profileImage !== undefined) user.profileImage = profileImage || null;

      await user.save();

      const profileImageUrl = user.profileImage
        ? await getPresignedGetUrl(user.profileImage)
        : null;

      return res.json({
        user: {
          id: user.id,
          username: user.username,
          dateOfBirth: user.dateOfBirth,
          gender: user.gender,
          profileImage: user.profileImage ?? null,
          profileImageUrl,
          quizHistory: user.quizHistory ?? [],
        },
      });
    } catch (err) {
      console.error("updateProfile error:", err);
      return res.status(500).json({ code: "SERVER_ERROR" });
    }
  }

  static async updatePassword(req: Request, res: Response) {
    try {
      const userId = (req as any)?.user?.id;
      if (!userId) return res.status(401).json({ code: "UNAUTHORIZED" });

      const { currentPassword, newPassword } = req.body ?? {};
      if (!currentPassword || !newPassword) {
        return res
          .status(400)
          .json({ code: "BAD REQUEST", message: "Current password and new password required" });
      }
      if (newPassword.length < 6) {
        return res.status(400).json({ code: "PASSWORD_TOO_SHORT" });
      }

      const user = await UserModel.findById(userId);
      if (!user) return res.status(404).json({ code: "NOT_FOUND" });

      const isValidPassword = await comparePassword(currentPassword, user.password);
      if (!isValidPassword) {
        return res.status(401).json({ code: "INVALID_PASSWORD" });
      }

      const hashed = await hashPassword(newPassword);
      user.password = hashed;
      await user.save();

      return res.json({ success: true });
    } catch (err) {
      console.error("updatePassword error:", err);
      return res.status(500).json({ code: "SERVER_ERROR" });
    }
  }

  static async getUserProfile(req: Request, res: Response) {
    try {
      const { userId } = req.params;
      if (!userId) return res.status(400).json({ code: "BAD_REQUEST", message: "User ID required" });

      const user = await UserModel.findById(userId).select(
        "_id username profileImage dateOfBirth gender quizHistory"
      );
      if (!user) return res.status(404).json({ code: "NOT_FOUND" });

      const profileImageUrl = user.profileImage
        ? await getPresignedGetUrl(user.profileImage)
        : null;

      return res.json({
        user: {
          id: user.id,
          username: user.username,
          dateOfBirth: user.dateOfBirth,
          gender: user.gender,
          profileImage: user.profileImage ?? null,
          profileImageUrl,
          quizHistory: user.quizHistory ?? [],
        },
      });
    } catch (err) {
      console.error("getUserProfile error:", err);
      return res.status(500).json({ code: "SERVER_ERROR" });
    }
  }
}
