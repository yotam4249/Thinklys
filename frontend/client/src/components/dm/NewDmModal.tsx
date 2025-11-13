import type { Dispatch, SetStateAction } from "react";

type Props = {
  open: boolean;
  creating: boolean;
  error: string | null;
  username: string;
  setUsername: Dispatch<SetStateAction<string>>;
  onClose: () => void;
  onCreate: () => void;
};

export function NewDmModal({
  open,
  creating,
  error,
  username,
  setUsername,
  onClose,
  onCreate,
}: Props) {
  if (!open) return null;

  return (
    <div className="dm-new-modal-backdrop" onClick={() => !creating && onClose()}>
      <div
        className="dm-new-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-dm-title"
      >
        <div className="dm-new-modal-header">
          <h4 id="new-dm-title">New Direct Message</h4>
          <button
            className="dm-new-modal-close"
            onClick={onClose}
            disabled={creating}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {error && (
          <div className="dm-new-modal-error">
            <span>⚠️</span>
            <span>{error}</span>
          </div>
        )}

        <div className="dm-new-modal-body">
          <label className="dm-new-modal-field">
            <span className="dm-new-modal-label">Username</span>
            <input
              className="dm-new-modal-input"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              disabled={creating}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && !creating && username.trim()) {
                  onCreate();
                }
                if (e.key === "Escape" && !creating) {
                  onClose();
                }
              }}
            />
          </label>
        </div>

        <div className="dm-new-modal-actions">
          <button
            className="dm-new-modal-btn-cancel"
            onClick={onClose}
            disabled={creating}
            type="button"
          >
            Cancel
          </button>
          <button
            className="dm-new-modal-btn-create"
            onClick={onCreate}
            disabled={creating || !username.trim()}
            type="button"
          >
            {creating ? (
              <>
                <span className="spinner" aria-hidden />
                Creating...
              </>
            ) : (
              "Create DM"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

