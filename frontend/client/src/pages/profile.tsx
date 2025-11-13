/* eslint-disable @typescript-eslint/no-explicit-any */
// src/pages/profile.tsx
import { useNavigate } from "react-router-dom";
import { useAppSelector, useAppDispatch } from "../store/hooks";
import { selectAuthUser } from "../store/slices/authSlice";
import { getCurrentUserThunk } from "../store/thunks/authThunk";
import { presignGet, presignUpload, uploadViaPresignedPut } from "../services/s3.service";
import { useEffect, useState } from "react";
import AuthService from "../services/auth.service";
import type { Gender } from "../types/user.type";
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

export default function Profile() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const user = useAppSelector(selectAuthUser);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarError, setAvatarError] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  // Load profile image
  useEffect(() => {
    // Reset error state when user changes
    setAvatarError(false);
    setAvatarUrl(null);

    if (!user?.profileImage) {
      // No profile image - will use fallback
      return;
    }

    // If we already have a URL, use it
    if (user.profileImageUrl) {
      setAvatarUrl(user.profileImageUrl);
      return;
    }

    // Otherwise, presign the S3 key
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
  }, [user?.profileImage, user?.profileImageUrl, user?.id]);

  if (!user) {
    return (
      <div className="profile-screen">
        <div className="profile-card">
          <p>Please log in to view your profile.</p>
          <button className="btn-primary" onClick={() => navigate("/login")}>
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  // Get the appropriate fallback avatar based on gender
  const fallbackAvatar = genderFallback(user.gender);
  
  // Determine which avatar to use:
  // - If there's a valid S3 image (profileImage exists, avatarUrl is set, and no error), use it
  // - Otherwise, use the gender-based fallback
  const hasValidS3Image = user.profileImage && avatarUrl && !avatarError;
  const finalAvatarSrc = hasValidS3Image ? avatarUrl : fallbackAvatar;
  
  // Debug logging (remove in production)
  console.log("Profile avatar debug:", {
    hasProfileImage: !!user.profileImage,
    avatarUrl,
    avatarError,
    gender: user.gender,
    fallbackAvatar,
    finalAvatarSrc,
    hasValidS3Image,
  });

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
        <h1 className="profile-title">My Profile</h1>
        <button className="btn-ghost back-btn" onClick={() => navigate("/home")}>
          ← Back to Home
        </button>
      </header>

      <div className="profile-layout">
        {/* Left Side - Profile Card */}
        <div className="profile-card">
          <div className="profile-card-header">
            <h3 className="profile-card-title">Profile Details</h3>
            <button 
              className="edit-profile-btn" 
              onClick={() => setIsEditModalOpen(true)}
              aria-label="Edit profile"
            >
               Edit
            </button>
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
                  console.error("Avatar image failed to load. Src was:", e.currentTarget.src);
                  console.error("Trying fallback:", fallbackAvatar);
                  // Force fallback
                  if (e.currentTarget.src !== fallbackAvatar) {
                    setAvatarError(true);
                    setAvatarUrl(null);
                    e.currentTarget.src = fallbackAvatar;
                    e.currentTarget.onerror = null; // Prevent infinite loop
                  }
                }}
                onLoad={() => {
                  console.log("✓ Avatar loaded:", finalAvatarSrc);
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
              <p className="quiz-history-empty-hint">Complete quizzes to see your history here!</p>
            </div>
          )}
        </div>
      </div>

      {/* Edit Profile Modal */}
      {isEditModalOpen && user && (
        <EditProfileModal
          user={user}
          onClose={() => setIsEditModalOpen(false)}
          onUpdate={async () => {
            setIsEditModalOpen(false);
            // Refresh user data
            await dispatch(getCurrentUserThunk());
          }}
        />
      )}
    </div>
  );
}

// Edit Profile Modal Component
function EditProfileModal({
  user,
  onClose,
  onUpdate,
}: {
  user: NonNullable<ReturnType<typeof selectAuthUser>>;
  onClose: () => void;
  onUpdate: () => void;
}) {
  const [dateOfBirth, setDateOfBirth] = useState(user.dateOfBirth ? new Date(user.dateOfBirth).toISOString().split('T')[0] : '');
  const [gender, setGender] = useState<Gender | "">(user.gender || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"profile" | "password">("profile");

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreview(reader.result as string);
      };
      reader.readAsDataURL(selectedFile);
    }
  };

  const handleSubmitProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      let profileImageKey = user.profileImage;

      // Upload new image if file selected
      if (file) {
        const contentType = file.type || "image/jpeg";
        const presigned = await presignUpload(contentType, {
          filename: `${Date.now()}-${file.name}`,
          prefix: `profile/${user.id}`,
        });
        await uploadViaPresignedPut(presigned.url, file, contentType);
        profileImageKey = presigned.key;
      }

      await AuthService.updateProfile({
        dateOfBirth: dateOfBirth || null,
        gender: gender || null,
        profileImage: profileImageKey,
      });

      onUpdate();
    } catch (err: any) {
      setError(err?.response?.data?.code || "Failed to update profile");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    if (newPassword !== confirmPassword) {
      setError("New passwords do not match");
      setLoading(false);
      return;
    }

    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters");
      setLoading(false);
      return;
    }

    try {
      await AuthService.updatePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setError(null);
      alert("Password updated successfully!");
      onClose();
    } catch (err: any) {
      setError(err?.response?.data?.code || "Failed to update password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="edit-profile-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Edit Profile</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-tabs">
          <button
            className={`modal-tab ${activeTab === "profile" ? "active" : ""}`}
            onClick={() => setActiveTab("profile")}
          >
            Profile
          </button>
          <button
            className={`modal-tab ${activeTab === "password" ? "active" : ""}`}
            onClick={() => setActiveTab("password")}
          >
            Password
          </button>
        </div>

        {error && <div className="modal-error">{error}</div>}

        {activeTab === "profile" ? (
          <form onSubmit={handleSubmitProfile} className="edit-profile-form">
            <div className="form-group">
              <label htmlFor="profileImageEdit">Profile Picture</label>
              <input
                id="profileImageEdit"
                type="file"
                accept="image/*"
                onChange={handleFileChange}
                className="edit-profile-file-input"
              />
              {preview && (
                <div className="profile-preview-container">
                  <img
                    src={preview}
                    alt="Preview"
                    className="profile-preview"
                  />
                </div>
              )}
            </div>

            <div className="form-group">
              <label>Date of Birth</label>
              <input
                type="date"
                value={dateOfBirth}
                onChange={(e) => setDateOfBirth(e.target.value)}
                max={new Date(new Date().setFullYear(new Date().getFullYear() - 16)).toISOString().split('T')[0]}
              />
            </div>

            <div className="form-group">
              <label>Gender</label>
              <select value={gender} onChange={(e) => setGender(e.target.value as Gender | "")}>
                <option value="">Select gender</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
                <option value="prefer_not_to_say">Prefer not to say</option>
              </select>
            </div>

            <div className="modal-actions">
              <button type="button" onClick={onClose} className="btn-secondary">
                Cancel
              </button>
              <button type="submit" disabled={loading} className="btn-primary">
                {loading ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleSubmitPassword} className="edit-profile-form">
            <div className="form-group">
              <label>Current Password</label>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label>New Password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>

            <div className="form-group">
              <label>Confirm New Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={6}
              />
            </div>

            <div className="modal-actions">
              <button type="button" onClick={onClose} className="btn-secondary">
                Cancel
              </button>
              <button type="submit" disabled={loading} className="btn-primary">
                {loading ? "Updating..." : "Update Password"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

