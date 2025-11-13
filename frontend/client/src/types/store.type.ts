import type { User } from "./user.type";

export type AuthStatus = 'idle' | 'loading' | 'succeeded' | 'failed';

export interface AuthState {
  user: User | null;
  status: AuthStatus;
  error: string | null;
}