type Props = { onLogout: () => void };

export function FixedLogoutButton({ onLogout }: Props) {
  return (
    <button
      className="btn-ghost focusable logout-btn-fixed"
      onClick={onLogout}
      aria-label="Logout"
      title="Logout"
    >
      Logout
    </button>
  );
}
