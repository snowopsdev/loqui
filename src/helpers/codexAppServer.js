const { spawn, execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { EventEmitter } = require("node:events");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const {
  MIN_CODEX_VERSION,
  parseVersion,
  supportedVersion,
  resolveCodexExecutable,
  verifyOfficialCodex,
} = require("./codexCli");

// Finder launches do not inherit terminal PATH customizations. Keep this scoped
// to Codex and include Node locations used by npm's Codex launcher as well.
function codexEnvironment(env, homeDir, platform) {
  const extra = [
    path.join(homeDir, ".local", "bin"),
    path.join(homeDir, ".npm-global", "bin"),
    path.join(homeDir, ".volta", "bin"),
    path.join(homeDir, ".local", "share", "mise", "shims"),
    path.join(homeDir, ".hermes", "node", "bin"),
  ];
  if (platform === "darwin")
    extra.push(
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/opt/homebrew/opt/node@24/bin",
      "/usr/local/opt/node@24/bin"
    );
  return {
    ...env,
    PATH: [...new Set([...(env.PATH || "").split(path.delimiter).filter(Boolean), ...extra])].join(
      path.delimiter
    ),
  };
}
const RESTRICTED_CONFIG = Object.freeze({
  "features.shell_tool": false,
  "features.shell_snapshot": false,
  "features.unified_exec": false,
  "features.code_mode": false,
  "features.code_mode_host": false,
  "features.apps": false,
  "features.plugins": false,
  "features.remote_plugin": false,
  "features.hooks": false,
  "features.multi_agent": false,
  "features.browser_use": false,
  "features.browser_use_external": false,
  "features.browser_use_full_cdp_access": false,
  "features.computer_use": false,
  "features.image_generation": false,
  "features.view_image": false,
  "features.in_app_browser": false,
  "features.in_app_chat": false,
  "features.in_app_dictation": false,
  "features.in_app_local_automation": false,
  "features.in_app_updates": false,
  "features.sleep_tool": false,
  "features.workspace_dependencies": false,
  "features.skill_search": false,
  "features.skill_mcp_dependency_install": false,
  "features.skip_host_skill_discovery": true,
  "features.goals": false,
  "features.memories": false,
  "features.request_permissions_tool": false,
  "agents.enabled": false,
  "analytics.enabled": false,
  "feedback.enabled": false,
  web_search: "disabled",
  project_doc_max_bytes: 0,
  cli_auth_credentials_store: "file",
  model_provider: "openai",
});
function failure(message, code = "CODEX_ERROR") {
  return Object.assign(new Error(message), { code });
}

class CodexAppServer extends EventEmitter {
  constructor({
    userDataPath,
    executable = "codex",
    spawnProcess = spawn,
    runFile = promisify(execFile),
    timeoutMs = 30000,
    env = process.env,
    homeDir = os.homedir(),
    platform = process.platform,
    resolveExecutable = resolveCodexExecutable,
    verifyRelease = verifyOfficialCodex,
  } = {}) {
    super();
    this.home = path.join(userDataPath, "codex");
    this.workspace = path.join(userDataPath, "codex-workspace");
    this.executable = executable;
    this.spawnProcess = spawnProcess;
    this.runFile = runFile;
    this.timeoutMs = timeoutMs;
    this.env = codexEnvironment(env, homeDir, platform);
    this.platform = platform;
    this.resolveExecutable = resolveExecutable;
    this.verifyRelease = verifyRelease;
    this.verifiedReleases = new Map();
    this.pending = new Map();
    this.turns = new Map();
    this.nextId = 0;
    this.buffer = "";
    this.child = null;
    this.starting = null;
  }

  async start() {
    if (this.starting) return this.starting;
    if (this.child) return;
    this.starting = this._start().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  async _start() {
    // The version probe and server both run with an isolated profile and no
    // inherited provider credentials. Resolve shims before probing the binary.
    await fs.mkdir(this.home, { recursive: true, mode: 0o700 });
    await fs.mkdir(this.workspace, { recursive: true, mode: 0o700 });
    const env = Object.fromEntries(
      Object.entries(this.env).filter(
        ([name]) => !/^(CODEX_|OPENAI_|AZURE_|AWS_|ANTHROPIC_|GEMINI_)/.test(name)
      )
    );
    env.CODEX_HOME = this.home;
    let version;
    let executable;
    try {
      executable = await this.resolveExecutable({
        executable: this.executable,
        env,
        platform: this.platform,
        runFile: this.runFile,
      });
      version = await this.runFile(executable, ["--version"], {
        timeout: this.timeoutMs,
        maxBuffer: 4096,
        env,
        cwd: this.workspace,
        windowsHide: true,
      });
    } catch (error) {
      if (error.code?.startsWith("CODEX_")) throw error;
      if (error.code === "ENOENT")
        throw failure(
          `Codex CLI was not found in PATH or common user installation folders. Install an official stable Codex CLI release ${MIN_CODEX_VERSION} or newer, then click Refresh.`,
          "CODEX_MISSING"
        );
      throw failure(
        "Codex CLI could not run. Check its executable permissions or reinstall the official CLI, then click Refresh.",
        "CODEX_PROCESS"
      );
    }
    this.version = String(version.stdout).trim();
    if (!supportedVersion(this.version)) {
      throw failure(
        `Found ${this.version}. Loqui requires an official stable Codex CLI release ${MIN_CODEX_VERSION} or newer.`,
        "CODEX_VERSION"
      );
    }
    await this.verifyRelease({
      executable,
      version: parseVersion(this.version),
      verifiedReleases: this.verifiedReleases,
      platform: this.platform,
      timeoutMs: this.timeoutMs,
    });
    const args = ["app-server", "--stdio"];
    for (const [key, value] of Object.entries(RESTRICTED_CONFIG))
      args.push("-c", `${key}=${JSON.stringify(value)}`);
    const child = this.spawnProcess(executable, args, {
      cwd: this.workspace,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;
    this.buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => this._consume(chunk));
    // Do not forward stderr: the CLI may include authentication or prompt data.
    child.stderr.resume();
    child.on(
      "error",
      (error) =>
        this.child === child &&
        this._disconnect(
          failure(`Codex could not start: ${error.code || "process error"}`, "CODEX_PROCESS")
        )
    );
    child.on(
      "exit",
      () =>
        this.child === child &&
        this._disconnect(
          failure(
            "Codex disconnected. Your input has been preserved; retry the request.",
            "CODEX_DISCONNECTED"
          )
        )
    );
    try {
      await this.request("initialize", {
        clientInfo: { name: "whispr_personal", title: "Loqui", version: "1.0.0" },
        capabilities: { experimentalApi: true },
      });
      this.send({ method: "initialized", params: {} });
    } catch (error) {
      this.stop();
      throw error;
    }
  }

  send(message) {
    if (!this.child?.stdin?.writable)
      throw failure("Codex is not connected.", "CODEX_DISCONNECTED");
    this.child.stdin.write(JSON.stringify(message) + "\n");
  }

  request(method, params = {}) {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(failure(`Codex request timed out (${method}).`, "CODEX_TIMEOUT"));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  _consume(chunk) {
    this.buffer += chunk;
    if (this.buffer.length > 16 * 1024 * 1024) {
      this.stop();
      return;
    }
    let newline;
    while ((newline = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, newline);
      this.buffer = this.buffer.slice(newline + 1);
      if (!line.trim()) continue;
      try {
        this._message(JSON.parse(line));
      } catch {
        const child = this.child;
        this._disconnect(
          failure("Codex returned an incompatible protocol response.", "CODEX_PROTOCOL")
        );
        child?.kill();
        return;
      }
    }
  }

  _message(message) {
    if (message.id !== undefined && !message.method) {
      const entry = this.pending.get(message.id);
      if (!entry) return;
      clearTimeout(entry.timer);
      this.pending.delete(message.id);
      if (message.error)
        entry.reject(failure(message.error.message || "Codex request failed.", "CODEX_RPC"));
      else entry.resolve(message.result);
      return;
    }
    if (message.id !== undefined) {
      void this._serverRequest(message).catch(() => {});
      return;
    }
    const params = message.params || {};
    this.emit("notification", { method: message.method, params });
    const turn = this.turns.get(params.threadId);
    if (!turn) return;
    if (message.method === "turn/started") turn.turnId = params.turn?.id;
    if (message.method === "item/agentMessage/delta") {
      turn.text += params.delta || "";
      turn.onText(params.delta || "");
    }
    if (message.method === "error" && !params.willRetry)
      turn.reject(failure(params.error?.message || "Codex request failed.", "CODEX_INFERENCE"));
    if (message.method === "turn/completed") {
      if (params.turn?.status === "completed") turn.resolve(turn.text);
      else
        turn.reject(
          failure(
            params.turn?.error?.message ||
              (params.turn?.status === "interrupted"
                ? "Request canceled."
                : "Codex could not complete this request."),
            params.turn?.status === "interrupted" ? "ABORT_ERR" : "CODEX_INFERENCE"
          )
        );
    }
  }

  async _serverRequest(message) {
    const params = message.params || {};
    const turn = this.turns.get(params.threadId);
    if (message.method === "item/tool/call") {
      let output;
      try {
        if (!turn || !turn.tools.has(params.tool) || params.namespace || ++turn.toolCalls > 20)
          throw new Error("Tool is not available for this request.");
        output = await turn.executeTool(params.tool, params.arguments, params.callId);
        this.send({
          id: message.id,
          result: {
            success: true,
            contentItems: [
              {
                type: "inputText",
                text: typeof output === "string" ? output : JSON.stringify(output),
              },
            ],
          },
        });
      } catch (error) {
        if (this.child)
          this.send({
            id: message.id,
            result: { success: false, contentItems: [{ type: "inputText", text: error.message }] },
          });
      }
    } else if (
      message.method === "item/commandExecution/requestApproval" ||
      message.method === "item/fileChange/requestApproval"
    ) {
      this.send({ id: message.id, result: { decision: "decline" } });
    } else if (message.method === "item/permissions/requestApproval") {
      this.send({ id: message.id, result: { permissions: {}, scope: "turn" } });
    } else {
      this.send({
        id: message.id,
        error: {
          code: -32601,
          message: "This integration only supports explicitly registered application tools.",
        },
      });
    }
  }

  async status() {
    try {
      await this.start();
      const result = await this.request("account/read", { refreshToken: false });
      return { available: true, version: this.version, account: result.account };
    } catch (error) {
      return { available: false, error: error.message, code: error.code };
    }
  }
  async login() {
    await this.start();
    return this.request("account/login/start", { type: "chatgpt" });
  }
  async cancelLogin(loginId) {
    await this.start();
    return this.request("account/login/cancel", { loginId });
  }
  async logout() {
    await this.start();
    return this.request("account/logout");
  }
  async models() {
    await this.start();
    const models = [];
    let cursor;
    do {
      const result = await this.request("model/list", { cursor, limit: 100 });
      models.push(...result.data);
      cursor = result.nextCursor;
    } while (cursor);
    return { data: models, nextCursor: null };
  }
  async rateLimits() {
    await this.start();
    return this.request("account/rateLimits/read");
  }

  async generate({
    model,
    messages,
    systemPrompt = "",
    tools = [],
    executeTool,
    signal,
    onText = () => {},
  }) {
    await this.start();
    if (signal?.aborted) throw failure("Request canceled.", "ABORT_ERR");
    const account = await this.request("account/read", { refreshToken: false });
    if (account.account?.type !== "chatgpt")
      throw failure(
        "Connect a ChatGPT subscription in Codex settings before using this provider.",
        "CODEX_LOGIN_REQUIRED"
      );
    const started = await this.request("thread/start", {
      model,
      modelProvider: "openai",
      allowProviderModelFallback: false,
      cwd: this.workspace,
      ephemeral: true,
      environments: [],
      runtimeWorkspaceRoots: [],
      selectedCapabilityRoots: [],
      approvalPolicy: "never",
      sandbox: "read-only",
      config: RESTRICTED_CONFIG,
      baseInstructions:
        "You are a text assistant embedded in Loqui. Process the supplied conversation. Use only the application tools explicitly provided for this request. Never access files, execute commands, browse, or use native tools.",
      developerInstructions: systemPrompt,
      dynamicTools: tools.map((tool) => ({
        type: "function",
        name: tool.name,
        description: tool.description,
        inputSchema: tool.parameters,
        deferLoading: false,
      })),
    });
    if (!started.thread?.id || started.model !== model || started.modelProvider !== "openai")
      throw failure(
        "Codex changed the selected model or returned an incompatible response.",
        "CODEX_PROTOCOL"
      );
    const threadId = started.thread.id;
    let abort;
    try {
      return await new Promise((resolve, reject) => {
        const turn = {
          resolve,
          reject,
          text: "",
          onText,
          tools: new Set(tools.map((tool) => tool.name)),
          toolCalls: 0,
          executeTool,
          turnId: null,
        };
        this.turns.set(threadId, turn);
        abort = () => {
          if (turn.turnId)
            void this.request("turn/interrupt", { threadId, turnId: turn.turnId }).catch(() => {});
          reject(failure("Request canceled.", "ABORT_ERR"));
        };
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) {
          abort();
          return;
        }
        const input = [
          { type: "text", text: JSON.stringify({ conversation: messages }), text_elements: [] },
        ];
        void this.request("turn/start", {
          threadId,
          input,
          environments: [],
          runtimeWorkspaceRoots: [],
        }).then((result) => {
          turn.turnId = result.turn?.id;
          if (signal?.aborted && turn.turnId)
            void this.request("turn/interrupt", { threadId, turnId: turn.turnId }).catch(() => {});
        }, reject);
      });
    } finally {
      signal?.removeEventListener("abort", abort);
      this.turns.delete(threadId);
      void this.request("thread/unsubscribe", { threadId }).catch(() => {});
    }
  }

  _disconnect(error) {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
    for (const turn of this.turns.values()) turn.reject(error);
    this.turns.clear();
    this.child = null;
  }
  stop() {
    const child = this.child;
    this._disconnect(failure("Codex stopped.", "CODEX_DISCONNECTED"));
    child?.kill();
  }
}
module.exports = { CodexAppServer, MIN_CODEX_VERSION, RESTRICTED_CONFIG, supportedVersion };
