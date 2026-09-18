export interface TextTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export interface TextRequest {
  requestId: string;
  provider: string;
  model: string;
  credentialRef?: string;
  baseUrl?: string;
  systemPrompt?: string;
  messages: Array<{ role: string; content: string | Array<Record<string, unknown>> }>;
  inferenceScope?: string;
  tools?: TextTool[];
  maxTokens?: number;
  temperature?: number;
  disableThinking?: boolean;
  webSearch?: boolean;
  requireCompleteOutput?: boolean;
  timeoutMs?: number;
}
export interface CodexAccount {
  type: string;
  email?: string | null;
  planType?: string;
}
export interface CodexModel {
  id: string;
  model: string;
  displayName: string;
  isDefault?: boolean;
  inputModalities?: string[];
}
export interface InferenceEvent {
  type: "chunk" | "end" | "error" | "tool" | "account";
  requestId?: string;
  chunk?: { type: string; text?: string; finishReason?: string };
  error?: string;
  code?: string;
  callId?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  method?: string;
  params?: Record<string, unknown>;
}
export interface PersonalInferenceAPI {
  codexStatus(): Promise<{
    available: boolean;
    version?: string;
    account?: CodexAccount | null;
    error?: string;
    code?: string;
  }>;
  codexLogin(): Promise<{ loginId: string }>;
  codexCancelLogin(loginId: string): Promise<unknown>;
  codexLogout(): Promise<unknown>;
  codexModels(): Promise<{ data: CodexModel[]; nextCursor: string | null }>;
  codexRateLimits(): Promise<{
    rateLimits?: { primary?: { usedPercent: number }; secondary?: { usedPercent: number } };
    rateLimitsByLimitId?: Record<string, unknown>;
  }>;
  models(input: {
    provider: string;
    baseUrl?: string;
    credentialRef?: string;
    inferenceScope?: string;
  }): Promise<{
    data: Array<{ id: string; name?: string; owned_by?: string; description?: string }>;
  }>;
  credentialStatus(ref: string): Promise<{ configured: boolean }>;
  credentialSave(ref: string, value: string): Promise<{ configured: boolean }>;
  textGenerate(request: TextRequest): Promise<{ text: string }>;
  textStream(request: TextRequest): Promise<void>;
  textCancel(requestId: string): Promise<void>;
  textToolResult(result: {
    requestId: string;
    callId: string;
    result?: unknown;
    error?: string;
  }): Promise<void>;
  onTextEvent(callback: (event: InferenceEvent) => void): () => void;
}
