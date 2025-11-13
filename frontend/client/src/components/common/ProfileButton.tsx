// src/components/common/ProfileButton.tsx
import { useNavigate } from "react-router-dom";

type Props = { onClick?: () => void };

export function ProfileButton({ onClick }: Props) {
  const navigate = useNavigate();

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else {
      navigate("/profile");
    }
  };

  return (
    <button
      className="btn-ghost focusable profile-btn-fixed"
      onClick={handleClick}
    >
      My Profile
    </button>
  );
}



