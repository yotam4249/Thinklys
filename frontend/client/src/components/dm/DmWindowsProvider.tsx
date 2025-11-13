/* eslint-disable react-refresh/only-export-components */
// src/components/dm/DmWindowsProvider.tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

export type DmWindowItem = {
  chatId: string;
  title: string;
  minimized?: boolean;
};

type Ctx = {
  windows: DmWindowItem[];
  openWindow: (w: { chatId: string; title: string }) => void;
  closeWindow: (chatId: string) => void;
  minimizeWindow: (chatId: string, val: boolean) => void;
  bringToFront: (chatId: string) => void;
};

const DmWindowsCtx = createContext<Ctx | null>(null);

export function DmWindowsProvider({ children }: { children: React.ReactNode }) {
  const [windows, setWindows] = useState<DmWindowItem[]>([]);

  const openWindow = useCallback((w: { chatId: string; title: string }) => {
    setWindows((prev) => {
      const exists = prev.find((x) => x.chatId === w.chatId);
      if (exists) {
        return [...prev.filter((x) => x.chatId !== w.chatId), { ...exists, minimized: false }];
      }
      const capped = prev.length >= 4 ? prev.slice(1) : prev;
      return [...capped, { chatId: w.chatId, title: w.title }];
    });
  }, []);

  const closeWindow = useCallback((chatId: string) => {
    setWindows((prev) => prev.filter((x) => x.chatId !== chatId));
  }, []);

  const minimizeWindow = useCallback((chatId: string, val: boolean) => {
    setWindows((prev) => prev.map((x) => (x.chatId === chatId ? { ...x, minimized: val } : x)));
  }, []);

  const bringToFront = useCallback((chatId: string) => {
    setWindows((prev) => {
      const hit = prev.find((x) => x.chatId === chatId);
      if (!hit) return prev;
      return [...prev.filter((x) => x.chatId !== chatId), { ...hit }];
    });
  }, []);

  const value = useMemo(
    () => ({ windows, openWindow, closeWindow, minimizeWindow, bringToFront }),
    [windows, openWindow, closeWindow, minimizeWindow, bringToFront]
  );

  return <DmWindowsCtx.Provider value={value}>{children}</DmWindowsCtx.Provider>;
}

export function useDmWindows() {
  const ctx = useContext(DmWindowsCtx);
  if (!ctx) throw new Error("useDmWindows must be used inside <DmWindowsProvider/>");
  return ctx;
}
