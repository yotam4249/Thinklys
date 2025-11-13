// src/components/home/ChatFilterTabs.tsx
import React from "react";

export type ChatFilter = "groups" | "discover";

type Props = {
  value: ChatFilter;
  onChange: (v: ChatFilter) => void;
  counts: { groups: number; discover: number };
};

export function ChatFilterTabs({ value, onChange, counts }: Props) {
  return (
    <div className="tabs">
      <button
        className={`tab ${value === "groups" ? "active" : ""}`}
        onClick={() => onChange("groups")}
      >
        My Groups {counts.groups ? `(${counts.groups})` : ""}
      </button>
      <button
        className={`tab ${value === "discover" ? "active" : ""}`}
        onClick={() => onChange("discover")}
      >
        Discover {counts.discover ? `(${counts.discover})` : ""}
      </button>
    </div>
  );
}
