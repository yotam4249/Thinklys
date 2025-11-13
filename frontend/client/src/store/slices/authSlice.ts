// /* eslint-disable @typescript-eslint/no-unused-vars */
import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { AuthState } from "../../types/store.type";
import type { User } from "../../types/user.type";
import { loginThunk, logoutThunk, registerThunk, getCurrentUserThunk } from "../thunks/authThunk";

const initialState: AuthState = {
  user: null,
  status: "idle",
  error: null,
};

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    // 👇 export this
    setUser: (state, action: PayloadAction<User | null>) => {
      state.user = action.payload;
    },
    // (optional) provide a full reset if you want
    resetAuth: (state) => {
      state.user = null;
      state.status = "idle";
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // LOGIN
      .addCase(loginThunk.pending, (state) => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(loginThunk.fulfilled, (state, action) => {
        state.status = "succeeded";
        state.user = action.payload;
      })
      .addCase(loginThunk.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.payload ?? "LOGIN_FAILED";
      })
      // REGISTER (stay logged out after register)
      .addCase(registerThunk.pending, (state) => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(registerThunk.fulfilled, (state) => {
        state.status = "succeeded";
        state.user = null; // <— important for your flow
      })
      .addCase(registerThunk.rejected, (state, action) => {
        state.status = "failed";
        state.error = action.payload ?? "REGISTER_FAILED";
      })
      // LOGOUT via thunk (kept for completeness)
      .addCase(logoutThunk.fulfilled, (state) => {
        state.status = "succeeded";
        state.user = null;
      })
      .addCase(logoutThunk.rejected, (state, action) => {
        state.status = "failed";
        state.user = null;
        state.error = action.payload ?? "LOGOUT_FAILED";
      })
      // GET CURRENT USER
      .addCase(getCurrentUserThunk.pending, (state) => {
        state.status = "loading";
        state.error = null;
      })
      .addCase(getCurrentUserThunk.fulfilled, (state, action) => {
        state.status = "succeeded";
        state.user = action.payload;
      })
      .addCase(getCurrentUserThunk.rejected, (state, action) => {
        state.status = "failed";
        state.user = null;
        state.error = action.payload ?? "FAILED_TO_GET_USER";
      });
  },
});

// 👇 export actions so services can dispatch
export const { setUser, resetAuth } = authSlice.actions;

export const selectAuthUser = (s: { auth: AuthState }) => s.auth.user;
export const selectAuthStatus = (s: { auth: AuthState }) => s.auth.status;
export const selectAuthError = (s: { auth: AuthState }) => s.auth.error;
export const selectIsAuthenticated = (s: { auth: AuthState }) => !!s.auth.user;
export const selectAuthIsLoading = (s: { auth: AuthState }) => s.auth.status === "loading";

export default authSlice.reducer;
