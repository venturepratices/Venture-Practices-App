"use client";

import { createContext, useContext, useState } from "react";

type AssetSidebarContextValue = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
};

const AssetSidebarContext = createContext<AssetSidebarContextValue | null>(null);

// Scoped to the Assets tab only — deliberately separate from the app-wide
// MobileSidebarProvider (src/components/layout/mobile-sidebar-context.tsx) so
// toggling the folder drawer never fights with the main nav drawer's state.
export function AssetSidebarProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <AssetSidebarContext.Provider
      value={{
        isOpen,
        open: () => setIsOpen(true),
        close: () => setIsOpen(false),
        toggle: () => setIsOpen((prev) => !prev),
      }}
    >
      {children}
    </AssetSidebarContext.Provider>
  );
}

export function useAssetSidebar() {
  const ctx = useContext(AssetSidebarContext);
  if (!ctx) throw new Error("useAssetSidebar must be used within AssetSidebarProvider");
  return ctx;
}
