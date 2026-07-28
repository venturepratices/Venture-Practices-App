"use client";

import { createContext, useContext, useState } from "react";

type WorkflowSidebarContextValue = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
};

const WorkflowSidebarContext = createContext<WorkflowSidebarContextValue | null>(null);

// Scoped to a client's Workflows tab only — separate from the app-wide
// MobileSidebarProvider so toggling the folder drawer never fights with the
// main nav drawer's state. Mirrors AssetSidebarProvider exactly.
export function WorkflowSidebarProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <WorkflowSidebarContext.Provider value={{ isOpen, open: () => setIsOpen(true), close: () => setIsOpen(false) }}>
      {children}
    </WorkflowSidebarContext.Provider>
  );
}

export function useWorkflowSidebar() {
  const ctx = useContext(WorkflowSidebarContext);
  if (!ctx) throw new Error("useWorkflowSidebar must be used within WorkflowSidebarProvider");
  return ctx;
}
