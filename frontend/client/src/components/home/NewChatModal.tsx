import type { Dispatch, SetStateAction } from "react";

type Props = {
  open: boolean;
  creating: boolean;
  createErr: string | null;
  newTitle: string;
  setNewTitle: Dispatch<SetStateAction<string>>;
  newMembers: string;
  setNewMembers: Dispatch<SetStateAction<string>>;
  onClose: () => void;
  onCreate: () => void;
};

export function NewChatModal({
  open,
  creating,
  createErr,
  newTitle,
  setNewTitle,
  newMembers,
  setNewMembers,
  onClose,
  onCreate,
}: Props) {
  if (!open) return null;

  return (
    <div className="modal-backdrop show" onClick={() => !creating && onClose()}>
      <div
        className="new-group-modal animate-in"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-group-title"
      >
        {/* Header */}
        <div className="new-group-modal-header">
          <div className="new-group-modal-icon">💬</div>
          <h2 id="create-group-title" className="new-group-modal-title">
            Create New Group Chat
          </h2>
          <p className="new-group-modal-subtitle">
            Start a conversation with your team
          </p>
        </div>

        {createErr && (
          <div className="new-group-error-toast" role="alert">
            <span className="new-group-error-icon">⚠️</span>
            <span>{createErr}</span>
          </div>
        )}

        {/* Form */}
        <div className="new-group-form">
          {/* Group Title */}
          <label className="new-group-field">
            <span className="new-group-label">
              <span className="new-group-label-icon">📝</span>
              Group Name
            </span>
            <input
              className="new-group-input"
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="e.g., Marketing Team, Project Alpha"
              disabled={creating}
              autoFocus
            />
          </label>

          {/* Members */}
          <label className="new-group-field">
            <span className="new-group-label">
              <span className="new-group-label-icon">👥</span>
              Add Members
              <span className="new-group-label-optional">(optional)</span>
            </span>
            <input
              className="new-group-input"
              type="text"
              value={newMembers}
              onChange={(e) => setNewMembers(e.target.value)}
              placeholder="username1, username2, username3"
              disabled={creating}
            />
            <small className="new-group-hint">
              Separate usernames with commas. You can add more members later.
            </small>
          </label>
        </div>

        {/* Actions */}
        <div className="new-group-actions">
          <button 
            className="new-group-btn-cancel" 
            onClick={onClose} 
            disabled={creating}
            type="button"
          >
            Cancel
          </button>
          <button 
            className="new-group-btn-create" 
            onClick={onCreate} 
            disabled={creating || !newTitle.trim()}
            type="button"
          >
            {creating ? (
              <>
                <span className="spinner" aria-hidden />
                Creating...
              </>
            ) : (
              <>
                <span className="new-group-btn-icon">✨</span>
                Create Group
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
