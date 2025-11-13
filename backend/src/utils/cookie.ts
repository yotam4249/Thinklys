// src/utils/cookie.ts
export const isProd = process.env.NODE_ENV === "production";

export const REFRESH_COOKIE_NAME = "refreshToken";

export const refreshCookieOptions = {
  httpOnly: true as const,
  secure: isProd,              // requires HTTPS in prod (Render gives you HTTPS)
  sameSite: "none" as const,   // set to "none" for cross-site SPA on different domain
  path: "/" as const,
  maxAge: 14 * 24 * 60 * 60 * 1000, // 14 days in ms
};

export const refreshCookieClear = {
  ...refreshCookieOptions,
  maxAge: 0,
};
