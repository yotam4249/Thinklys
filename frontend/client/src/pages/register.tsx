// src/pages/register.tsx
/* eslint-disable @typescript-eslint/no-unused-vars */
import React, { useMemo, useState, useEffect } from "react";
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
  const [uploading, setUploading] = useState(false);

  // UI
  const [showPw, setShowPw] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);

  // Cleanup preview URL on unmount
  useEffect(() => {
    return () => {
      if (preview) {
        URL.revokeObjectURL(preview);
      }
    };
  }, [preview]);

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
    !isLoading &&
    !uploading;

  function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    if (f) {
      // Cleanup previous preview
      if (preview) {
        URL.revokeObjectURL(preview);
      }
      setFile(f);
      setPreview(URL.createObjectURL(f));
    } else {
      if (preview) {
        URL.revokeObjectURL(preview);
      }
      setFile(null);
      setPreview(null);
    }
  }

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!canSubmit) return;

    // Will hold the S3 key returned from presigned upload
    let profileImage: string | undefined;

    // 1) Upload to S3 first (if a file was chosen)
    if (file) {
      setUploading(true);
      try {
        const contentType = file.type || "image/jpeg";
        const { url, key } = await presignUpload(contentType, {
          filename: username.trim().toLowerCase(),
          prefix: "users/new",
        });
        await uploadViaPresignedPut(url, file, contentType);
        profileImage = key;
      } catch (err) {
        console.error("Failed to upload profile image:", err);
        setUploading(false);
        return;
      }
      setUploading(false);
    }

    // 2) Register with the profileImage key
    try {
      await dispatch(
        registerThunk({
          username: username.trim().toLowerCase(),
          password,
          dateOfBirth: dateOfBirth || undefined,
          gender: (gender as Gender) || undefined,
          profileImage,
        })
      ).unwrap();

      // Navigate to login after successful registration
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
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
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
            <div className="form-field">
              <label className="auth-label" htmlFor="username">
                Username
                {usernameError && <span className="field-error-indicator" aria-hidden="true"> *</span>}
              </label>
              <input
                id="username"
                className={`auth-input ${usernameError ? "error" : ""} ${focusedField === "username" ? "focused" : ""}`}
                placeholder="choose a username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                onFocus={() => setFocusedField("username")}
                onBlur={() => setFocusedField(null)}
                autoComplete="username"
                disabled={isLoading || uploading}
                aria-invalid={usernameError ? "true" : "false"}
                aria-describedby={usernameError ? "username-error" : undefined}
              />
              {usernameError && (
                <p className="auth-msg" id="username-error" role="alert">
                  {usernameError}
                </p>
              )}
            </div>

            <div className="form-field">
              <label className="auth-label" htmlFor="password">
                Password
                {passwordError && <span className="field-error-indicator" aria-hidden="true"> *</span>}
              </label>
              <div className="auth-input-wrapper">
                <input
                  id="password"
                  className={`auth-input ${passwordError ? "error" : ""} ${focusedField === "password" ? "focused" : ""}`}
                  type={showPw ? "text" : "password"}
                  placeholder="at least 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setFocusedField("password")}
                  onBlur={() => setFocusedField(null)}
                  autoComplete="new-password"
                  disabled={isLoading || uploading}
                  aria-invalid={passwordError ? "true" : "false"}
                  aria-describedby={passwordError ? "password-error" : undefined}
                />
                <button
                  type="button"
                  className="pw-toggle-inside"
                  onClick={() => setShowPw((s) => !s)}
                  disabled={isLoading || uploading}
                  aria-label={showPw ? "Hide password" : "Show password"}
                  tabIndex={0}
                >
                  <img src={showPw ? visibilityOff : visibility} alt="" className="pw-icon" />
                </button>
              </div>
              {passwordError && (
                <p className="auth-msg" id="password-error" role="alert">
                  {passwordError}
                </p>
              )}
            </div>

            <div className="form-field">
              <label className="auth-label" htmlFor="dateOfBirth">
                Date of Birth <span className="optional-label">(optional)</span>
                {dateError && <span className="field-error-indicator" aria-hidden="true"> *</span>}
              </label>
              <input
                id="dateOfBirth"
                type="date"
                className={`auth-input ${dateError ? "error" : ""} ${focusedField === "dateOfBirth" ? "focused" : ""}`}
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
                onFocus={() => setFocusedField("dateOfBirth")}
                onBlur={() => setFocusedField(null)}
                disabled={isLoading || uploading}
                aria-invalid={dateError ? "true" : "false"}
                aria-describedby={dateError ? "date-error" : undefined}
              />
              {dateError && (
                <p className="auth-msg" id="date-error" role="alert">
                  {dateError}
                </p>
              )}
            </div>

            <div className="form-field">
              <label className="auth-label" htmlFor="gender">
                Gender <span className="optional-label">(optional)</span>
              </label>
              <select
                id="gender"
                className={`auth-input ${focusedField === "gender" ? "focused" : ""}`}
                value={gender}
                onChange={(e) => setGender(e.target.value as Gender | "")}
                onFocus={() => setFocusedField("gender")}
                onBlur={() => setFocusedField(null)}
                disabled={isLoading || uploading}
              >
                <option value="">Select gender</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
                <option value="prefer_not_to_say">Prefer not to say</option>
              </select>
            </div>

            <div className="form-field">
              <label className="auth-label" htmlFor="profileImage">
                Profile image <span className="optional-label">(optional)</span>
              </label>
              <input
                id="profileImage"
                type="file"
                accept="image/*"
                className={`auth-input ${focusedField === "profileImage" ? "focused" : ""}`}
                onChange={onPickFile}
                onFocus={() => setFocusedField("profileImage")}
                onBlur={() => setFocusedField(null)}
                disabled={isLoading || uploading}
              />
              {preview && (
                <div className="profile-preview-container">
                  <img
                    src={preview}
                    alt="Profile preview"
                    className="profile-preview"
                  />
                  <button
                    type="button"
                    className="remove-preview"
                    onClick={() => {
                      if (preview) URL.revokeObjectURL(preview);
                      setFile(null);
                      setPreview(null);
                    }}
                    aria-label="Remove profile image"
                    disabled={isLoading || uploading}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              )}
            </div>

            <button 
              className="btn-primary" 
              type="submit" 
              disabled={!canSubmit || isLoading || uploading}
              aria-busy={isLoading || uploading}
            >
              {isLoading || uploading ? (
                <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                  <span className="spinner" style={{ width: "16px", height: "16px", borderWidth: "2px" }} />
                  {uploading ? "Uploading image…" : "Creating account…"}
                </span>
              ) : (
                "Create account"
              )}
            </button>

            <div className="btn-row">
              <Link to="/login" className="btn-ghost">
                Already have an account? <strong>Sign in</strong>
              </Link>
            </div>

            {error && (
              <div className="auth-msg" role="alert" id="error-message">
                <svg 
                  width="16" 
                  height="16" 
                  viewBox="0 0 24 24" 
                  fill="none" 
                  stroke="currentColor" 
                  strokeWidth="2"
                  style={{ marginRight: "8px", flexShrink: 0 }}
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>{error}</span>
              </div>
            )}
          </form>
        </div>
      </section>
    </div>
  );
}
