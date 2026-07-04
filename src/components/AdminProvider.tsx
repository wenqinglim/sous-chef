"use client";

/**
 * Carries the server-derived isAdmin flag to any client component that needs
 * to gate UI. UI hiding is UX only — the API is the security boundary.
 */

import { createContext, useContext } from "react";

const AdminContext = createContext(false);

export function AdminProvider({
  isAdmin,
  children,
}: {
  isAdmin: boolean;
  children: React.ReactNode;
}) {
  return (
    <AdminContext.Provider value={isAdmin}>{children}</AdminContext.Provider>
  );
}

export function useIsAdmin(): boolean {
  return useContext(AdminContext);
}
