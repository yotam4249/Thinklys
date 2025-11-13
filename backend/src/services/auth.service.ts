import * as jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { IUser, UserModel } from "../models/user.model";

function reqEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

const ACCESS_TTL: string  = process.env.ACCESS_TTL  || "15m";
const REFRESH_TTL: string = process.env.REFRESH_TTL || "14d";
const ACCESS_SECRET: string  = reqEnv("ACCESS_SECRET");
const REFRESH_SECRET: string = reqEnv("REFRESH_SECRET");

export type JwtPayload = {
  sub: string;
  username: string;
};

export async function hashPassword(plain: string) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(plain, salt);
}
export function comparePassword(plain: string, hashed: string) {
  return bcrypt.compare(plain, hashed);
}

export function signAccess(user: IUser): string {
    const payload: JwtPayload = { sub: user.id, username: user.username };
    return jwt.sign(
      payload,
      ACCESS_SECRET as jwt.Secret,                 
      { expiresIn: ACCESS_TTL } as jwt.SignOptions 
    );
  }
  
  export function signRefresh(user: IUser): string {
    const payload: JwtPayload = { sub: user.id, username: user.username };
    return jwt.sign(
      payload,
      REFRESH_SECRET as jwt.Secret,
      { expiresIn: REFRESH_TTL } as jwt.SignOptions
    );
  }

export function verifyAccess(token: string) {
  return jwt.verify(token, ACCESS_SECRET) as JwtPayload & jwt.JwtPayload;
}

export function verifyRefresh(token: string) {
  return jwt.verify(token, REFRESH_SECRET) as JwtPayload & jwt.JwtPayload;
}

export async function issueTokens(user: IUser) {
    const accessToken = signAccess(user);
    const refreshToken = signRefresh(user);
    user.refreshTokens.push(refreshToken);
    await user.save();
    return { accessToken, refreshToken };
  }
  
  export async function rotateRefresh(userId: string, oldToken: string) {
    const user = await UserModel.findById(userId);
    if (!user) return null;
    user.refreshTokens = user.refreshTokens.filter((t) => t !== oldToken);
    const newToken = signRefresh(user);
    user.refreshTokens.push(newToken);
    await user.save();
    return newToken;
  }
  
  export async function revokeRefresh(userId: string, token: string) {
    const user = await UserModel.findById(userId);
    if (!user) return false;
    user.refreshTokens = user.refreshTokens.filter((t) => t !== token);
    await user.save();
    return true;
  }