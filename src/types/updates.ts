export type UpdateStatus = {
  phase: "idle" | "manual" | "checking" | "downloading" | "ready" | "error";
  enabled: boolean;
  channel: "stable" | "beta";
  version: string;
  availableVersion?: string;
  progress?: number;
  error?: string;
  busy: boolean;
  supported: boolean;
  releasesUrl: string;
};
export interface UpdatesAPI {
  status(): Promise<UpdateStatus>;
  preferences(patch: { enabled?: boolean; channel?: "stable" | "beta" }): Promise<UpdateStatus>;
  check(): Promise<UpdateStatus>;
  completeSetup(): Promise<UpdateStatus>;
  restart(): Promise<void>;
  onStatus(callback: (status: UpdateStatus) => void): () => void;
  onPrepare(callback: (nonce: string) => void): () => void;
  prepared(nonce: string, error?: boolean): void;
}
