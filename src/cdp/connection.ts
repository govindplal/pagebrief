// Minimal Chrome DevTools Protocol client over Node's built-in WebSocket.
// One browser-level connection; page sessions are multiplexed on it with
// flattened sessionIds (Target.attachToTarget { flatten: true }).

export interface CdpEvent {
  method: string;
  // CDP event payloads are typed per method; callers narrow what they read.
  params: any;
  sessionId?: string;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  method: string;
}

export class CdpConnection {
  #ws: WebSocket;
  #nextId = 0;
  #pending = new Map<number, Pending>();
  #listeners = new Set<(e: CdpEvent) => void>();
  #closed = false;

  private constructor(ws: WebSocket) {
    this.#ws = ws;
    ws.addEventListener("message", (ev) => this.#onMessage(String(ev.data)));
    ws.addEventListener("close", () => {
      this.#closed = true;
      for (const p of this.#pending.values()) p.reject(new Error(`CDP connection closed during ${p.method}`));
      this.#pending.clear();
    });
  }

  static async connect(url: string, timeoutMs = 10_000): Promise<CdpConnection> {
    const ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`CDP connect timed out: ${url}`)), timeoutMs);
      ws.addEventListener("open", () => (clearTimeout(timer), resolve()), { once: true });
      ws.addEventListener("error", () => (clearTimeout(timer), reject(new Error(`CDP connect failed: ${url}`))), { once: true });
    });
    return new CdpConnection(ws);
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<T> {
    if (this.#closed) return Promise.reject(new Error(`CDP connection closed; cannot send ${method}`));
    const id = ++this.#nextId;
    this.#ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, { resolve: resolve as (v: unknown) => void, reject, method });
    });
  }

  /** Subscribe to all events; returns an unsubscribe function. */
  onEvent(listener: (e: CdpEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  close(): void {
    if (!this.#closed) this.#ws.close();
  }

  #onMessage(raw: string): void {
    let msg: { id?: number; result?: unknown; error?: { message: string }; method?: string; params?: unknown; sessionId?: string };
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.id !== undefined) {
      const p = this.#pending.get(msg.id);
      if (!p) return;
      this.#pending.delete(msg.id);
      if (msg.error) p.reject(new Error(`${p.method}: ${msg.error.message}`));
      else p.resolve(msg.result);
    } else if (msg.method) {
      const event: CdpEvent = { method: msg.method, params: msg.params ?? {}, sessionId: msg.sessionId };
      for (const l of this.#listeners) l(event);
    }
  }
}
