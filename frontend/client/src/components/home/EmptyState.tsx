type Props = { onCreateClick: () => void };

export function EmptyState({ onCreateClick }: Props) {
  return (
    <div className="empty-state">
      <div className="empty-illustration" aria-hidden />
      <h3>No chats yet</h3>
      <p>Create your first chat and start talking.</p>
      <button className="btn-primary" onClick={onCreateClick}>
        Create a chat
      </button>
    </div>
  );
}
