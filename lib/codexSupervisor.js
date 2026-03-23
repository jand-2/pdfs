import { EventEmitter } from "node:events";
import { execFile, spawn } from "node:child_process";

const READY_TIMEOUT_MS = 25_000;
const TURN_TIMEOUT_MS = 10 * 60 * 1000;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runCli(bin, args, timeoutMs = 15_000) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error((stderr || error.message).trim() || "Codex CLI command failed"));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

export class CodexSupervisor extends EventEmitter {
  constructor(options = {}) {
    super();
    this.codexBin = options.codexBin ?? process.env.CODEX_BIN ?? "codex";
    this.host = options.host ?? "127.0.0.1";
    this.port = Number(options.port ?? process.env.CODEX_APP_SERVER_PORT ?? 4019);
    this.debug = Boolean(options.debug ?? process.env.DEBUG_CODEX_APP_SERVER);

    this.process = null;
    this.ws = null;
    this.pending = new Map();
    this.nextId = 1;
    this.startPromise = null;
    this.loginStatus = new Map();
    this.processStartError = null;
  }

  async start() {
    if (!this.startPromise) {
      this.startPromise = this.#boot();
    }
    return this.startPromise;
  }

  async #boot() {
    this.#spawnProcess();
    await this.#connectAndInitialize();
  }

  #spawnProcess() {
    if (this.process && this.process.exitCode === null) {
      return;
    }

    this.processStartError = null;
    const listenUrl = `ws://${this.host}:${this.port}`;
    this.process = spawn(this.codexBin, ["app-server", "--listen", listenUrl], {
      stdio: ["ignore", "pipe", "pipe"]
    });

    this.process.on("error", (error) => {
      this.processStartError = error;
      this.#rejectPending(error);
      this.startPromise = null;
      if (this.listenerCount("error") > 0) {
        this.emit("error", error);
      }
    });

    this.process.stdout?.on("data", (chunk) => {
      if (this.debug) {
        process.stdout.write(`[codex-app-server] ${chunk}`);
      }
    });

    this.process.stderr?.on("data", (chunk) => {
      if (this.debug) {
        process.stderr.write(`[codex-app-server] ${chunk}`);
      }
    });

    this.process.on("exit", (code, signal) => {
      if (this.debug) {
        console.error(`codex app-server exited (code=${code}, signal=${signal ?? "none"})`);
      }
      this.#rejectPending(new Error("Codex app-server exited"));
      this.ws = null;
      this.startPromise = null;
      this.emit("exit", { code, signal });
    });
  }

  async #connectAndInitialize() {
    const startAt = Date.now();
    let lastError = null;

    while (Date.now() - startAt < READY_TIMEOUT_MS) {
      if (this.processStartError) {
        if (this.processStartError.code === "ENOENT") {
          throw new Error(
            `Could not find '${this.codexBin}' in PATH. Install Codex CLI, or set CODEX_BIN to its full path.`
          );
        }
        throw new Error(`Failed to start Codex app-server: ${this.processStartError.message}`);
      }

      try {
        await this.#connectSocket();
        await this.#sendRequest("initialize", {
          clientInfo: {
            name: "codex-pdf-local-app",
            version: "0.1.0"
          },
          capabilities: {
            experimentalApi: true
          }
        }, true);
        this.notify("initialized", undefined);
        return;
      } catch (error) {
        lastError = error;
        await wait(250);
      }
    }

    throw new Error(`Failed to initialize codex app-server: ${lastError?.message ?? "unknown error"}`);
  }

  async #connectSocket() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return;
    }

    const url = `ws://${this.host}:${this.port}`;

    await new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      const timeout = setTimeout(() => {
        socket.close();
        reject(new Error("Timed out connecting to codex app-server"));
      }, 4_000);

      socket.onopen = () => {
        clearTimeout(timeout);
        this.ws = socket;
        this.#attachSocketHandlers(socket);
        resolve();
      };

      socket.onerror = () => {
        clearTimeout(timeout);
        reject(new Error("Failed to connect to codex app-server WebSocket"));
      };
    });
  }

  #attachSocketHandlers(socket) {
    socket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data.toString());
        this.#handleMessage(data);
      } catch (error) {
        if (this.debug) {
          console.error("Failed to parse app-server message", error);
        }
      }
    };

    socket.onclose = () => {
      if (this.ws === socket) {
        this.ws = null;
      }
    };
  }

  #handleMessage(message) {
    if (message?.id !== undefined && (Object.hasOwn(message, "result") || Object.hasOwn(message, "error"))) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) {
        pending.reject(new Error(message.error.message ?? "JSON-RPC error"));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message?.method && message?.id !== undefined) {
      this.#handleServerRequest(message);
      return;
    }

    if (message?.method) {
      this.#handleNotification(message);
    }
  }

  #handleServerRequest(message) {
    const { method, id } = message;

    const respond = (result) => {
      this.#sendRaw({ jsonrpc: "2.0", id, result });
    };

    const respondError = (errorMessage) => {
      this.#sendRaw({
        jsonrpc: "2.0",
        id,
        error: {
          code: -32000,
          message: errorMessage
        }
      });
    };

    switch (method) {
      case "item/commandExecution/requestApproval":
        respond({ decision: "accept" });
        return;
      case "item/fileChange/requestApproval":
        respond({ decision: "accept" });
        return;
      case "item/tool/requestUserInput":
        respond({ answers: {} });
        return;
      case "item/tool/call":
        respond({ success: false, contentItems: [{ type: "inputText", text: "Dynamic tool call is unsupported." }] });
        return;
      case "execCommandApproval":
        respond({ decision: "approved" });
        return;
      case "applyPatchApproval":
        respond({ decision: "approved" });
        return;
      case "account/chatgptAuthTokens/refresh":
        respondError("chatgpt token refresh is not supported by this client");
        return;
      default:
        respondError(`Unsupported server request method: ${method}`);
    }
  }

  #handleNotification(message) {
    this.emit("notification", message);

    const { method, params } = message;

    if (method === "account/login/completed") {
      if (params?.loginId) {
        this.loginStatus.set(params.loginId, {
          success: Boolean(params.success),
          error: params.error ?? null,
          updatedAt: Date.now()
        });
      }
      this.emit("loginCompleted", params);
      return;
    }

    if (method === "item/agentMessage/delta") {
      this.emit("agentMessageDelta", {
        threadId: params?.threadId,
        turnId: params?.turnId,
        itemId: params?.itemId,
        delta: params?.delta ?? ""
      });
      return;
    }

    if (method === "item/completed" && params?.item?.type === "agentMessage") {
      this.emit("agentMessageCompleted", {
        threadId: params.threadId,
        turnId: params.turnId,
        item: params.item
      });
      return;
    }

    if (method === "turn/completed") {
      this.emit("turnCompleted", params);
      return;
    }

    if (method === "turn/started") {
      this.emit("turnStarted", params);
      return;
    }

    if (method === "codex/event/agent_message_content_delta") {
      this.emit("agentMessageDelta", {
        threadId: params?.conversationId,
        turnId: params?.msg?.turn_id,
        itemId: params?.msg?.item_id,
        delta: params?.msg?.delta ?? ""
      });
      return;
    }

    if (method === "codex/event/item_completed" && params?.msg?.item?.type === "AgentMessage") {
      const text = (params.msg.item.content ?? [])
        .filter((part) => part?.type === "Text")
        .map((part) => part.text)
        .join("");

      this.emit("agentMessageCompleted", {
        threadId: params?.conversationId,
        turnId: params?.msg?.turn_id,
        item: {
          type: "agentMessage",
          phase: params?.msg?.item?.phase,
          text
        }
      });
      return;
    }

    if (method === "codex/event/task_complete") {
      this.emit("turnCompleted", {
        threadId: params?.conversationId,
        turn: {
          id: params?.msg?.turn_id,
          status: "completed",
          error: null
        }
      });
    }
  }

  async request(method, params) {
    await this.start();
    return this.#sendRequest(method, params, false);
  }

  #sendRequest(method, params, skipStart) {
    if (!skipStart && !this.startPromise) {
      throw new Error("Codex supervisor is not started");
    }

    const id = this.nextId++;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timed out: ${method}`));
      }, 30_000);

      this.pending.set(id, { resolve, reject, timeout });

      this.#sendRaw({
        jsonrpc: "2.0",
        id,
        method,
        params
      });
    });
  }

  notify(method, params) {
    this.#sendRaw({
      jsonrpc: "2.0",
      method,
      params
    });
  }

  #sendRaw(payload) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("codex app-server socket is not connected");
    }
    this.ws.send(JSON.stringify(payload));
  }

  #rejectPending(error) {
    for (const [id, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  isConnected() {
    return Boolean(this.ws && this.ws.readyState === WebSocket.OPEN);
  }

  async getAccount() {
    return this.request("account/read", { refreshToken: true });
  }

  async startChatgptLogin() {
    return this.request("account/login/start", { type: "chatgpt" });
  }

  async logout() {
    await this.stop();
    await runCli(this.codexBin, ["logout"]);
    this.loginStatus.clear();
  }

  getLoginStatus(loginId) {
    return this.loginStatus.get(loginId) ?? null;
  }

  async startThread(cwd) {
    return this.request("thread/start", {
      cwd,
      approvalPolicy: "never",
      sandbox: "read-only",
      experimentalRawEvents: false,
      persistExtendedHistory: true
    });
  }

  async listModels() {
    return this.request("model/list", {});
  }

  async runTurn({ threadId, text, cwd, model = null, timeoutMs = TURN_TIMEOUT_MS }) {
    const turnParams = {
      threadId,
      input: [{ type: "text", text, text_elements: [] }],
      cwd,
      approvalPolicy: "never"
    };

    if (model) {
      turnParams.model = model;
    }

    const turnStart = await this.request("turn/start", turnParams);

    const turnId = turnStart?.turn?.id;
    if (!turnId) {
      throw new Error("turn/start did not return a turn id");
    }

    return new Promise((resolve, reject) => {
      let accumulated = "";
      let finalMessage = "";

      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("Turn timed out"));
      }, timeoutMs);

      const onDelta = (event) => {
        if (event.turnId === turnId) {
          accumulated += event.delta ?? "";
        }
      };

      const onCompletedMessage = (event) => {
        if (event.turnId === turnId && event.item?.text) {
          finalMessage = event.item.text;
        }
      };

      const onTurnCompleted = (event) => {
        if (event?.turn?.id !== turnId) {
          return;
        }
        cleanup();
        resolve({
          turnId,
          status: event.turn.status,
          error: event.turn.error ?? null,
          output: (finalMessage || accumulated).trim()
        });
      };

      const cleanup = () => {
        clearTimeout(timeout);
        this.off("agentMessageDelta", onDelta);
        this.off("agentMessageCompleted", onCompletedMessage);
        this.off("turnCompleted", onTurnCompleted);
      };

      this.on("agentMessageDelta", onDelta);
      this.on("agentMessageCompleted", onCompletedMessage);
      this.on("turnCompleted", onTurnCompleted);
    });
  }

  async stop() {
    this.#rejectPending(new Error("Supervisor stopped"));
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Ignore socket shutdown failures.
      }
      this.ws = null;
    }

    const process = this.process;
    if (process && process.exitCode === null) {
      await new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) {
            return;
          }
          settled = true;
          resolve();
        };

        process.once("exit", finish);

        try {
          process.kill("SIGTERM");
        } catch {
          finish();
          return;
        }

        setTimeout(() => {
          if (process.exitCode === null) {
            try {
              process.kill("SIGKILL");
            } catch {
              // Ignore forced shutdown failures.
            }
          }
        }, 2000);

        setTimeout(finish, 2400);
      });
    }

    this.process = null;
    this.startPromise = null;
  }
}
