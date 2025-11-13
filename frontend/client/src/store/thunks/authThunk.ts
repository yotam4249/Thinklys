/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { createAsyncThunk } from "@reduxjs/toolkit";
import AuthService from "../../services/auth.service";
import { type Gender, type User } from "../../types/user.type";

export const loginThunk = createAsyncThunk<
    User,
    { username: string, password: string },
    { rejectValue : string }
>(
    'auth/login',
    async(payload, { rejectWithValue }) =>{
        try{
            const user = await AuthService.login({
                username: payload.username,
                password: payload.password
            });
            return user;
        }catch(err : any){
            const code = err?.response?.data?.code ?? 'LOGIN_FAILED';
            return rejectWithValue(code);
        }
    }
);

export const registerThunk = createAsyncThunk<
    User,
    { username: string; password: string; dateOfBirth?: string; gender?: Gender ,profileImage?: string | null;},
    { rejectValue: string }
>(
    'auth/register',
    async(payload,{ rejectWithValue }) =>{
        try{
            const user = await AuthService.register(payload);
            return user;
        }catch(err: any){
            const code = err?.response?.data?.code ?? 'REGISTER_FAILED';
            return rejectWithValue(code);
        }
    }
);

export const logoutThunk = createAsyncThunk<void, void, { rejectValue: string }>(
    'auth/logout',
    async (_, { rejectWithValue }) => {
      try {
        await AuthService.logout();
      } catch (err: any) {
        const code = err?.response?.data?.code ?? 'LOGOUT_FAILED';
        return rejectWithValue(code);
      }
    }
  );

export const getCurrentUserThunk = createAsyncThunk<
    User | null,
    void,
    { rejectValue: string }
>(
    'auth/getCurrentUser',
    async (_, { rejectWithValue }) => {
        try {
            const user = await AuthService.getCurrentUser();
            return user;
        } catch (err: any) {
            const code = err?.response?.data?.code ?? 'FAILED_TO_GET_USER';
            return rejectWithValue(code);
        }
    }
);