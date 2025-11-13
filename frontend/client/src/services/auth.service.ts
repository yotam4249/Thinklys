// const AuthService = { register, login, logout };
// export default AuthService;
// src/services/auth.service.ts
import api, { TokenManager } from "./api";
import type { Gender, User } from "../types/user.type";
import { store } from "../store/store";
import { setUser } from "../store/slices/authSlice";

type AuthResponse = {
  user: User;
  accessToken: string;
  refreshToken: string;
};

export type Credentials = {
  username: string;
  password: string;
  dateOfBirth?: string;
  gender?: Gender;
  /** S3 key from the upload step */
  profileImage?: string | null;
};

async function register(creds: Credentials): Promise<User> {
  const { data } = await api.post<AuthResponse>("/auth/register", creds);
  // Your flow keeps user logged-out after register (navigate to /login)
  return data.user;
}

async function login(creds: Credentials): Promise<User> {
  const { data } = await api.post<AuthResponse>("/auth/login", creds);
  TokenManager.set(data.accessToken, data.refreshToken);
  store.dispatch(setUser(data.user)); // will include profileImageUrl if backend sent it
  return data.user;
}

async function logout(): Promise<void> {
  const refresh = TokenManager.refresh ?? localStorage.getItem("refreshToken");
  try {
    if (refresh) await api.post("/auth/logout", { refreshToken: refresh });
  } finally {
    TokenManager.clear();
    store.dispatch(setUser(null));
  }
}

async function getCurrentUser(): Promise<User | null> {
  try {
    const { data } = await api.get<{ user: User }>("/auth/me");
    return data.user;
  } catch {
    // If not authenticated, return null (thunk will handle state update)
    return null;
  }
}

async function updateProfile(updates: {
  dateOfBirth?: string | null;
  gender?: string | null;
  profileImage?: string | null;
}): Promise<User> {
  const { data } = await api.put<{ user: User }>("/auth/profile", updates);
  store.dispatch(setUser(data.user));
  return data.user;
}

async function updatePassword(currentPassword: string, newPassword: string): Promise<void> {
  await api.put("/auth/password", { currentPassword, newPassword });
}

const AuthService = { register, login, logout, getCurrentUser, updateProfile, updatePassword };
export default AuthService;
