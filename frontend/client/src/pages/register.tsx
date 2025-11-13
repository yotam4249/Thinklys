
// src/pages/register.tsx
/* eslint-disable @typescript-eslint/no-unused-vars */
import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Gender } from "../types/user.type";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import { selectAuthError, selectAuthIsLoading } from "../store/slices/authSlice";
import "../styles/register.css";
import visibility from "../assets/visibility.svg";
import visibilityOff from "../assets/visibilityOff.svg";
import { registerThunk } from "../store/thunks/authThunk";
import { presignUpload, uploadViaPresignedPut } from "../services/s3.service";

type FieldError = string | null;

export default function Register() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  const error = useAppSelector(selectAuthError);
  const isLoading = useAppSelector(selectAuthIsLoading);

  // form fields
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState<Gender | "">("");

  // image state
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  // UI
  const [showPw, setShowPw] = useState(false);

  // validations
  const usernameError: FieldError = useMemo(() => {
    if (!username) return null;
    const u = username.trim().toLowerCase();
    if (u.length < 3) return "Username must be at least 3 characters.";
    if (u.length > 30) return "Username must be at most 30 characters.";
    if (!/^[a-z0-9._-]+$/.test(u))
      return "Only lowercase letters, numbers, dot, underscore and hyphen are allowed.";
    return null;
  }, [username]);

  const passwordError: FieldError = useMemo(() => {
    if (!password) return null;
    if (password.length < 6) return "Password must be at least 6 characters.";
    return null;
  }, [password]);

  const underage = useMemo(() => {
    if (!dateOfBirth) return false;
    const d = new Date(dateOfBirth);
    if (Number.isNaN(d.getTime())) return false;
    const msYear = 365.25 * 24 * 3600 * 1000;
    const age = Math.floor((Date.now() - d.getTime()) / msYear);
    return age < 16;
  }, [dateOfBirth]);

  const dateError: FieldError = useMemo(() => {
    if (!dateOfBirth) return null;
    const d = new Date(dateOfBirth);
    if (Number.isNaN(d.getTime())) return "Please enter a valid date.";
    if (underage) return "You must be at least 16 years old to register.";
    return null;
  }, [dateOfBirth, underage]);

  const canSubmit =
    !!username &&
    !!password &&
    !usernameError &&
    !passwordError &&
    !dateError &&
    !underage &&
    !isLoading;

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f);
    setPreview(f ? URL.createObjectURL(f) : null);
  }

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canSubmit) return;

    // Will hold the S3 key returned from presigned upload
    let profileImage: string | undefined;

    // 1) Upload to S3 first (if a file was chosen)
    if (file) {
      const contentType = file.type || "image/jpeg";
      // filename used for nicer keys, not required
      const { url, key } = await presignUpload(contentType, {
        filename: username.trim().toLowerCase(),
        prefix: "users/new",
      });
      await uploadViaPresignedPut(url, file, contentType);
      profileImage = key; // store this on the user
    }

    // 2) Register with the profileImage key
    try {
      await dispatch(
        registerThunk({
          username: username.trim().toLowerCase(),
          password,
          dateOfBirth: dateOfBirth || undefined,
          gender: (gender as Gender) || undefined,
          profileImage, // send S3 key to backend
        })
      ).unwrap();

      // Your flow: go to login (user is not auto-logged-in)
      navigate("/login", { replace: true });
    } catch {
      // Slice handles error state
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-blob" />
      <div className="auth-blob b2" />

      <section className="auth-card">
        <div className="visual-pane">
          <span className="visual-badge">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <path d="M12 2a10 10 0 100 20 10 10 0 000-20zm1 10h3l-4 6V12H9l4-6v6z" />
            </svg>
            Get started
          </span>
          <h2 className="visual-title">Create your account</h2>
          <p className="visual-copy">
            Join Thinkly to learn and collaborate with your friends.
          </p>
        </div>

        <div className="form-pane">
          <header className="form-header">
            <h1 className="auth-heading">Create account</h1>
            <p className="auth-subheading">Join Thinkly in a few seconds</p>
          </header>

          <form onSubmit={onSubmit} noValidate>
            <label className="auth-label" htmlFor="username">Username</label>
            <input
              id="username"
              className="auth-input"
              placeholder="choose a username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
            />
            {usernameError && <p className="auth-msg">{usernameError}</p>}

            <label className="auth-label" htmlFor="password">Password</label>
            <div className="auth-input-wrapper">
              <input
                id="password"
                className="auth-input"
                type={showPw ? "text" : "password"}
                placeholder="at least 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
              />
              <button
                type="button"
                className="pw-toggle-inside"
                onClick={() => setShowPw((s) => !s)}
                aria-label="Toggle password visibility"
              >
                <img src={showPw ? visibilityOff : visibility} alt="" className="pw-icon" />
              </button>
            </div>
            {passwordError && <p className="auth-msg">{passwordError}</p>}

            <label className="auth-label" htmlFor="dateOfBirth">Date of Birth (optional)</label>
            <input
              id="dateOfBirth"
              type="date"
              className="auth-input"
              value={dateOfBirth}
              onChange={(e) => setDateOfBirth(e.target.value)}
            />
            {dateError && <p className="auth-msg">{dateError}</p>}

            <label className="auth-label" htmlFor="gender">Gender (optional)</label>
            <select
              id="gender"
              className="auth-input"
              value={gender}
              onChange={(e) => setGender(e.target.value as Gender | "")}
            >
              <option value="">Select</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
              <option value="other">Other</option>
              <option value="prefer_not_to_say">Prefer not to say</option>
            </select>

            <label className="auth-label" htmlFor="profileImage">Profile image (optional)</label>
            <input
              id="profileImage"
              type="file"
              accept="image/*"
              className="auth-input"
              onChange={onPickFile}
            />
            {preview && (
              <div className="profile-preview-container">
                <img
                  src={preview}
                  alt="preview"
                  className="profile-preview"
                />
              </div>
            )}

            <button className="btn-primary" type="submit" disabled={!canSubmit || isLoading}>
              {isLoading ? "Creating…" : "Create account"}
            </button>

            <div className="btn-row">
              <Link to="/login" className="btn-ghost">Already have an account? Sign in</Link>
            </div>

            {error && <p className="auth-msg" role="alert">{error}</p>}
          </form>
        </div>
      </section>
    </div>
  );
}
