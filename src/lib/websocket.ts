import { getValidAccessToken } from "./api";
import type { MessageResponse, WebSocketFrame } from "../types/api";

type MessageHandler = (message: MessageResponse) => void;
type StatusHandler = (status: "connecting" | "connected" | "disconnected") => void;

export class WhisperSocket {
  private socket: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private stopped = false;
  private statusHandler?: StatusHandler;

  constructor(private readonly onMessage: MessageHandler) {}

  onStatus(handler: StatusHandler): void {
    this.statusHandler = handler;
  }

  async connect(): Promise<void> {
    this.stopped = false;
    const token = await getValidAccessToken();
    if (!token) return;

    this.statusHandler?.("connecting");
    const wsBase = import.meta.env.VITE_WS_BASE_URL ?? "wss://whisperbox.koyeb.app";
    this.socket = new WebSocket(`${wsBase}/ws?token=${encodeURIComponent(token)}`);

    this.socket.onopen = () => this.statusHandler?.("connected");
    this.socket.onclose = () => {
      this.statusHandler?.("disconnected");
      this.scheduleReconnect();
    };
    this.socket.onerror = () => {
      this.statusHandler?.("disconnected");
      this.socket?.close();
    };
    this.socket.onmessage = (event) => this.handleFrame(event.data);
  }

  send(to: string, payload: unknown): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) return false;
    this.socket.send(JSON.stringify({ event: "message.send", to, payload }));
    return true;
  }

  disconnect(): void {
    this.stopped = true;
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.socket?.close();
    this.socket = null;
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, 2500);
  }

  private handleFrame(raw: string): void {
    try {
      const frame = JSON.parse(raw) as WebSocketFrame;
      const eventName = frame.event ?? frame.type;
      if (eventName !== "message.receive") return;
      const message = ((frame.message ?? frame.data) as MessageResponse | undefined) ?? this.messageFromTopLevel(frame);
      if (message) this.onMessage(message);
    } catch {
      // Malformed frames are ignored; they should not take down the chat UI.
    }
  }

  private messageFromTopLevel(frame: WebSocketFrame): MessageResponse | undefined {
    const candidate = frame as Record<string, unknown>;
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.from_user_id !== "string" ||
      typeof candidate.to_user_id !== "string" ||
      typeof candidate.created_at !== "string" ||
      !isEncryptedPayload(candidate.payload)
    ) {
      return undefined;
    }

    return {
      id: candidate.id,
      from_user_id: candidate.from_user_id,
      to_user_id: candidate.to_user_id,
      payload: candidate.payload,
      delivered: typeof candidate.delivered === "boolean" ? candidate.delivered : true,
      created_at: candidate.created_at,
    };
  }
}

function isEncryptedPayload(value: unknown): value is MessageResponse["payload"] {
  if (!value || typeof value !== "object") return false;
  const payload = value as Record<string, unknown>;
  return (
    typeof payload.ciphertext === "string" &&
    typeof payload.iv === "string" &&
    typeof payload.encryptedKey === "string" &&
    typeof payload.encryptedKeyForSelf === "string"
  );
}
