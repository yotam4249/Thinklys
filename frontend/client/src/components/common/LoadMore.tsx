type Props = {
    onClick: () => void;
    loading: boolean;
  };
  
  export function LoadMore({ onClick, loading }: Props) {
    return (
      <div className="center" style={{ padding: "8px 0 6px" }}>
        <button
          className="load-more-btn btn-ghost focusable"
          onClick={onClick}
          disabled={loading}
        >
          {loading ? <span className="spinner" /> : "Load more"}
        </button>
      </div>
    );
  }
  