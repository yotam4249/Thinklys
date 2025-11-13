// src/components/dm/DmWindows.tsx
import React from "react";
import { useDmWindows } from "./DmWindowsProvider";
import { DmWindow } from "./DmWindow";
import "../../styles/dm.css";

export function DmWindows() {
  const { windows } = useDmWindows();
  return (
    <div className="dmw-stage" aria-live="polite" aria-relevant="additions">
      {windows.map((w, i) => (
        <DmWindow key={w.chatId} chatId={w.chatId} title={w.title} index={i} />
      ))}
    </div>
  );
}
