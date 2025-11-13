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

  return (
    <div className="auth-screen">
      <div className="auth-blob" />
      <div className="auth-blob b2" />

      <section className="auth-card">
        {/* Left side */}
        <div className="visual-pane">
          <span className="visual-badge">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
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
          <header style={{ textAlign: "center", marginBottom: 10 }}>
            <h1 className="auth-heading">Sign in</h1>
            <p className="auth-subheading">Access your Thinkly account</p>
          </header>

          <form onSubmit={onSubmit} noValidate>
            <label className="auth-label" htmlFor="username">Username</label>
            <div className="auth-input-wrapper">
              <input
                id="username"
                className="auth-input"
                placeholder="Username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>

            <label className="auth-label" htmlFor="password">Password</label>
            <div className="auth-input-wrapper">
              <input
                id="password"
                className="auth-input"
                type={showPw ? "text" : "password"}
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="pw-toggle-inside"
                onClick={() => setShowPw((s) => !s)}
              >
                <img
                  src={showPw ? visibilityOff : visibility}
                  alt="toggle"
                  className="pw-icon"
                />
              </button>
            </div>

            <button
              className="btn-primary"
              type="submit"
              disabled={status === "loading" || !username || !password}
            >
              {status === "loading" ? "Signing in…" : "Sign in"}
            </button>

            <div className="btn-row">
              <Link to="/register" className="btn-ghost">
                Create new account
              </Link>
            </div>

            {error && <p className="auth-msg" role="alert">{error}</p>}
          </form>
        </div>
      </section>
    </div>
  );
}
