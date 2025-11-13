export function SkeletonList({ rows = 6 }: { rows?: number }) {
    return (
      <ul className="chat-list">
        {Array.from({ length: rows }).map((_, i) => (
          <li key={i} className="chat-item skeleton">
            <div className="avatar" />
            <div className="chat-info">
              <div className="sk-line w-60" />
              <div className="sk-line w-40" />
            </div>
            <div className="chat-time">
              <div className="sk-line w-24" />
            </div>
          </li>
        ))}
      </ul>
    );
  }
  