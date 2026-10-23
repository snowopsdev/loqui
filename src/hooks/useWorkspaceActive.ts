import { createContext, useContext } from "react";

export const WorkspaceActivity = createContext(true);
/** Pause new workspace interaction without retiring admitted operations. */
export const useWorkspaceActive = () => useContext(WorkspaceActivity);
