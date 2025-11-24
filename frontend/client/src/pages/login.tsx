import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "../store/hooks";
import {
  selectAuthStatus,
  selectAuthError,
  selectAuthUser,
} from "../store/slices/authSlice";
import "../styles/login.css";
import visibility from "../assets/visibility.svg";
import visibilityOff from "../assets/visibilityOff.svg";
import { loginThunk } from "../store/thunks/authThunk";

export default function Login() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();

  const status = useAppSelector(selectAuthStatus);
  const error = useAppSelector(selectAuthError);
  const user = useAppSelector(selectAuthUser);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [focusedField, setFocusedField] = useState<string | null>(null);

  // Redirect if logged in
  useEffect(() => {
    if (user) {
      navigate("/home", { replace: true });
    }
  }, [user, navigate]);

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!username || !password || status === "loading") return;

    dispatch(
      loginThunk({
        username: username.trim().toLowerCase(),
        password,
      })
    );
  };

  const isLoading = status === "loading";
  const isFormValid = username.trim().length > 0 && password.length > 0;

  return (
    <div className="auth-screen">
      <div className="auth-blob" />
      <div className="auth-blob b2" />

      <section className="auth-card">
        {/* Left visual side */}
        <div className="visual-pane">
          <span className="visual-badge">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.88L18.18 22 12 18.77 5.82 22 7 14.15l-5-4.88 6.91-1.01L12 2z" />
            </svg>
            Thinkly
          </span>
          <h2 className="visual-title">Welcome back</h2>
          <p className="visual-copy">
            Sign in to start learning and collaborate with your friends!
          </p>
        </div>

        {/* Right form side */}
        <div className="form-pane">
          <header className="form-header">
            <h1 className="auth-heading">Sign in</h1>
            <p className="auth-subheading">Access your Thinkly account</p>
          </header>

          <form onSubmit={onSubmit} noValidate>
            <div className="form-field">
              <label className="auth-label" htmlFor="username">
                Username
              </label>
              <div className="auth-input-wrapper">
                <input
                  id="username"
                  className={`auth-input ${focusedField === "username" ? "focused" : ""}`}
                  placeholder="Enter your username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  onFocus={() => setFocusedField("username")}
                  onBlur={() => setFocusedField(null)}
                  autoComplete="username"
                  disabled={isLoading}
                  aria-invalid={error ? "true" : "false"}
                  aria-describedby={error ? "error-message" : undefined}
                />
              </div>
            </div>

            <div className="form-field">
              <label className="auth-label" htmlFor="password">
                Password
              </label>
              <div className="auth-input-wrapper">
                <input
                  id="password"
                  className={`auth-input ${focusedField === "password" ? "focused" : ""}`}
                  type={showPw ? "text" : "password"}
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onFocus={() => setFocusedField("password")}
                  onBlur={() => setFocusedField(null)}
                  autoComplete="current-password"
                  disabled={isLoading}
                  aria-invalid={error ? "true" : "false"}
                  aria-describedby={error ? "error-message" : undefined}
                />
                <button
                  type="button"
                  className="pw-toggle-inside"
                  onClick={() => setShowPw((s) => !s)}
                  disabled={isLoading}
                  aria-label={showPw ? "Hide password" : "Show password"}
                  tabIndex={0}
                >
                  <img
                    src={showPw ? visibilityOff : visibility}
                    alt={showPw ? "Hide password" : "Show password"}
                    className="pw-icon"
                  />
                </button>
              </div>
            </div>

            <button
              className="btn-primary"
              type="submit"
              disabled={!isFormValid || isLoading}
              aria-busy={isLoading}
            >
              {isLoading ? (
                <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                  <span className="spinner" style={{ width: "16px", height: "16px", borderWidth: "2px" }} />
                  Signing in…
                </span>
              ) : (
                "Sign in"
              )}
            </button>

            <div className="btn-row">
              <Link to="/register" className="btn-ghost">
                Don't have an account? <strong>Create one</strong>
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
