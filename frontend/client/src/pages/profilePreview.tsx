// src/pages/profilePreview.tsx
import { useNavigate, useParams } from "react-router-dom";
import { useEffect, useState } from "react";
import { presignGet } from "../services/s3.service";
import type { User } from "../types/user.type";
import api from "../services/api";
import "../styles/profile.css";

// Fallback avatars
import maleAvatar from "../assets/male.svg";
import femaleAvatar from "../assets/female.svg";
import neutralAvatar from "../assets/neutral.svg";

const genderFallback = (gender?: string | null) => {
  const g = (gender ?? "other").toString().toLowerCase();
  if (g === "male") return maleAvatar;
  if (g === "female") return femaleAvatar;
  return neutralAvatar;
};

export default function ProfilePreview() {
  const navigate = useNavigate();
  const { userId } = useParams<{ userId: string }>();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState(false);

  // Fetch user profile
  useEffect(() => {
    if (!userId) {
      setError("User ID not provided");
      setLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const { data } = await api.get<{ user: User }>(`/auth/user/${userId}`);
        if (cancelled) return;
        setUser(data.user);
      } catch (err: any) {
        if (cancelled) return;
        setError(err?.response?.data?.code || "Failed to load profile");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Load profile image
  useEffect(() => {
    if (!user?.profileImage) return;

    setAvatarError(false);
    setAvatarUrl(null);

    if (user.profileImageUrl) {
      setAvatarUrl(user.profileImageUrl);
      return;
    }

    if (user.profileImage && typeof user.profileImage === "string") {
      if (/^https?:\/\//i.test(user.profileImage)) {
        setAvatarUrl(user.profileImage);
      } else {
        presignGet(user.profileImage)
          .then((url) => {
            setAvatarUrl(url);
            setAvatarError(false);
          })
          .catch(() => {
            setAvatarError(true);
            setAvatarUrl(null);
          });
      }
    }
  }, [user?.profileImage, user?.profileImageUrl]);

  const calculateAge = (dateString?: string): number | null => {
    if (!dateString) return null;
    try {
      const birthDate = new Date(dateString);
      const today = new Date();
      let age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
      return age;
    } catch {
      return null;
    }
  };

  const formatGender = (gender?: string | null) => {
    if (!gender) return "Not provided";
    return gender
      .split("_")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  };

  const formatQuizDate = (dateString: string) => {
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return dateString;
    }
  };

  if (loading) {
    return (
      <div className="profile-screen">
        <div className="profile-card">
          <p>Loading profile...</p>
        </div>
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="profile-screen">
        <div className="profile-card">
          <p>{error || "User not found"}</p>
          <button className="btn-primary" onClick={() => navigate(-1)}>
            Go Back
          </button>
        </div>
      </div>
    );
  }

  const fallbackAvatar = genderFallback(user.gender);
  const hasValidS3Image = user.profileImage && avatarUrl && !avatarError;
  const finalAvatarSrc = hasValidS3Image ? avatarUrl : fallbackAvatar;
  const quizHistory = user?.quizHistory ?? [];
  const sortedQuizHistory = [...quizHistory].sort((a, b) => {
    const dateA = new Date(a.completedAt).getTime();
    const dateB = new Date(b.completedAt).getTime();
    return dateB - dateA; // Most recent first
  });
  const age = calculateAge(user.dateOfBirth);

  return (
    <div className="profile-screen">
      <header className="profile-screen-header">
        <h1 className="profile-title">User Profile</h1>
        <button className="btn-ghost back-btn" onClick={() => navigate(-1)}>
          ← Back
        </button>
      </header>

      <div className="profile-layout">
        {/* Left Side - Profile Card */}
        <div className="profile-card">
          <div className="profile-card-header">
            <h3 className="profile-card-title">Profile Details</h3>
          </div>
          <div className="profile-avatar-section">
            <div className="avatar-container">
              <img
                key={`avatar-${user.id}`}
                src={finalAvatarSrc}
                alt="Profile"
                className="profile-avatar"
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  display: "block",
                }}
                onError={(e) => {
                  if (e.currentTarget.src !== fallbackAvatar) {
                    setAvatarError(true);
                    setAvatarUrl(null);
                    e.currentTarget.src = fallbackAvatar;
                    e.currentTarget.onerror = null; // Prevent infinite loop
                  }
                }}
              />
            </div>
          </div>

          <div className="profile-info">
            <div className="info-row">
              <span className="info-label">Username</span>
              <span className="info-value">{user.username}</span>
            </div>

            <div className="info-row">
              <span className="info-label">Age</span>
              <span className="info-value">{age !== null ? `${age} years old` : "Not provided"}</span>
            </div>

            <div className="info-row">
              <span className="info-label">Gender</span>
              <span className="info-value">{formatGender(user.gender)}</span>
            </div>
          </div>
        </div>

        {/* Right Side - Quiz History */}
        <div className="quiz-history-card">
          <h2 className="quiz-history-title">Quiz History</h2>
          {sortedQuizHistory.length > 0 ? (
            <div className="quiz-history-list">
              {sortedQuizHistory.map((quiz, index) => {
                const percentage = Math.round((quiz.score / quiz.total) * 100);
                return (
                  <div key={index} className="quiz-history-item">
                    <div className="quiz-history-header">
                      <div className="quiz-history-topic">
                        <strong>{quiz.topic}</strong>
                        <span className="quiz-history-level">{quiz.level}</span>
                      </div>
                      <div className="quiz-history-score">
                        <span className="quiz-score-number">{quiz.score}/{quiz.total}</span>
                        <span className={`quiz-score-percentage ${percentage >= 80 ? 'excellent' : percentage >= 60 ? 'good' : 'practice'}`}>
                          {percentage}%
                        </span>
                      </div>
                    </div>
                    <div className="quiz-history-date">
                      Completed: {formatQuizDate(quiz.completedAt)}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="quiz-history-empty">
              <p>No quizzes completed yet.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

