"use client";

import { createContext, useContext } from "react";

export interface ShellProject {
  id: string;
  codeProjet: string;
  client: string;
  nomJeu: string;
  category?: string;
  isSandbox: boolean;
}

export interface ShellCurrentUser {
  id: string;
  email: string;
  name: string;
  jobTitle: string | null;
  role: string;
  avatarId: string;
  avatarBg: string;
}

export interface ShellStatus {
  projects: ShellProject[];
  activeProjectId: string | null;
  activeProject: ShellProject | null;
  activeProjectAccess?: {
    canView: boolean;
    canEdit: boolean;
    canManageMembers: boolean;
    accessRole: string | null;
  } | null;
  currentUser?: ShellCurrentUser | null;
  oauthConfigured?: boolean;
  authRequired?: boolean;
  googleConnected: boolean;
  googleEmail: string | null;
  geminiConfigured: boolean;
  sandboxMode: boolean;
  cpConflictCount: number;
  extDriftCount: number;
  pendingInvoicesCount?: number;
  lateTasksCount?: number;
  myTasksCount?: number;
}

export interface ShellContextValue {
  status: ShellStatus | null;
  loading: boolean;
  refreshShell: () => Promise<void>;
  selectProject: (projectId: string) => Promise<void>;
}

export const ShellContext = createContext<ShellContextValue>({
  status: null,
  loading: true,
  refreshShell: async () => undefined,
  selectProject: async () => undefined,
});

export function useShell(): ShellContextValue {
  return useContext(ShellContext);
}
