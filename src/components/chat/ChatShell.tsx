import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { LockKeyhole, MessageSquarePlus, Search, Send, ShieldAlert, ShieldCheck } from "lucide-react";
import type { CryptoIdentity } from "../../App";
import {
  getConversationMessages,
  getConversations,
  getPublicKey,
  searchUsers,
  sendMessage as sendMessageRest,
} from "../../lib/api";
import { buildEncryptedPayload, decryptAESKey, decryptMessage } from "../../lib/crypto";
import type { StoredSession } from "../../lib/storage";
import { WhisperSocket } from "../../lib/websocket";
import type { ConversationSummary, DecryptedMessage, MessageResponse, UserPublicInfo } from "../../types/api";
import { TopBar } from "../layout/TopBar";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";

type ChatShellProps = {
  session: StoredSession;
  crypto: CryptoIdentity;
  onLogout: () => void;
};

type Thread = ConversationSummary | (UserPublicInfo & { user_id: string; last_message_at: string | null });

function partnerId(thread: Thread): string {
  return thread.user_id;
}

export function ChatShell({ session, crypto, onLogout }: ChatShellProps) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeThread, setActiveThread] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<DecryptedMessage[]>([]);
  const [messageText, setMessageText] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<UserPublicInfo[]>([]);
  const [status, setStatus] = useState<"connecting" | "connected" | "disconnected">("disconnected");
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const socketRef = useRef<WhisperSocket | null>(null);
  const seenIncomingIdsRef = useRef<Set<string>>(new Set());

  const decryptHistoryMessage = useCallback(
    async (message: MessageResponse): Promise<DecryptedMessage> => {
      try {
        const encryptedKey = message.from_user_id === session.user.id ? message.payload.encryptedKeyForSelf : message.payload.encryptedKey;
        const aesKey = await decryptAESKey(encryptedKey, crypto.privateKey);
        const plaintext = await decryptMessage(message.payload.ciphertext, message.payload.iv, aesKey);
        return { ...message, plaintext };
      } catch {
        return { ...message, plaintext: "Unable to decrypt this message.", decryptError: "Decryption failed" };
      }
    },
    [crypto.privateKey, session.user.id],
  );

  const loadConversations = useCallback(async () => {
    try {
      setConversations(await getConversations());
    } catch (error) {
      setConversations([]);
      setError(error instanceof Error ? error.message : "Could not load conversations.");
    }
  }, []);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    const socket = new WhisperSocket((incoming) => {
      if (seenIncomingIdsRef.current.has(incoming.id)) return;
      seenIncomingIdsRef.current.add(incoming.id);
      if (seenIncomingIdsRef.current.size > 500) {
        seenIncomingIdsRef.current = new Set([...seenIncomingIdsRef.current].slice(-250));
      }

      void decryptHistoryMessage(incoming).then((decrypted) => {
        const openPartner = activeThread ? partnerId(activeThread) : null;
        const incomingPartner = incoming.from_user_id === session.user.id ? incoming.to_user_id : incoming.from_user_id;
        if (openPartner === incomingPartner) {
          setMessages((current) => mergeMessages([...current, decrypted]));
        }
        void loadConversations();
      });
    });
    socket.onStatus(setStatus);
    socketRef.current = socket;
    void socket.connect();

    return () => socket.disconnect();
  }, [activeThread, decryptHistoryMessage, loadConversations, session.user.id]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      return;
    }
    const timeout = window.setTimeout(() => {
      void searchUsers(trimmed)
        .then(setResults)
        .catch(() => setResults([]));
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [query]);

  async function openThread(thread: Thread) {
    setActiveThread(thread);
    setError("");
    setLoadingMessages(true);
    try {
      const history = await getConversationMessages(partnerId(thread));
      const decrypted = await Promise.all(history.map(decryptHistoryMessage));
      setMessages(decrypted.reverse());
    } catch (error) {
      setError(error instanceof Error ? error.message : "Could not load message history.");
    } finally {
      setLoadingMessages(false);
    }
  }

  async function startSearchThread(user: UserPublicInfo) {
    const thread = { ...user, user_id: user.id, last_message_at: null };
    setQuery("");
    setResults([]);
    await openThread(thread);
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (!activeThread || !messageText.trim()) return;

    const plaintext = messageText.trim();
    setSending(true);
    setError("");
    let tempMessageId = "";
    try {
      const recipientId = partnerId(activeThread);
      const recipientPublicKey = await getPublicKey(recipientId);
      const payload = await buildEncryptedPayload(plaintext, recipientPublicKey, crypto.publicKeyBase64);
      tempMessageId = cryptoRandomId();
      const tempMessage: DecryptedMessage = {
        id: tempMessageId,
        from_user_id: session.user.id,
        to_user_id: recipientId,
        payload,
        delivered: status === "connected",
        created_at: new Date().toISOString(),
        plaintext,
        pending: true,
      };
      setMessages((current) => mergeMessages([...current, tempMessage]));
      setMessageText("");

      const socketSent = socketRef.current?.send(recipientId, payload);
      if (!socketSent) {
        const stored = await sendMessageRest({ to: recipientId, payload });
        const decryptedStored = await decryptHistoryMessage(stored);
        setMessages((current) => mergeMessages([...current.filter((item) => item.id !== tempMessage.id), decryptedStored]));
      }
      void loadConversations();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Message encryption or send failed.";
      setError(message);
      if (tempMessageId) {
        setMessages((current) =>
          current.map((item) =>
            item.id === tempMessageId
              ? { ...item, pending: false, delivered: false, deliveryError: `Delivery failed: ${message}` }
              : item,
          ),
        );
      }
    } finally {
      setSending(false);
    }
  }

  const activePartnerName = activeThread?.display_name ?? "Select a conversation";
  const orderedConversations = useMemo(() => conversations, [conversations]);

  return (
    <main className="flex h-screen flex-col bg-paper text-ink">
      <TopBar session={session} connection={status} onLogout={onLogout} />
      <div className="grid min-h-0 flex-1 md:grid-cols-[320px_1fr]">
        <aside className="flex min-h-0 flex-col border-r border-slate-200 bg-white">
          <div className="border-b border-slate-200 p-4">
            <Input
              label="Search users"
              placeholder="Username or display name"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {results.length ? (
              <div className="mt-3 max-h-52 overflow-auto rounded-md border border-slate-200">
                {results.map((user) => (
                  <button
                    className="flex w-full items-center gap-3 border-b border-slate-100 px-3 py-3 text-left last:border-0 hover:bg-slate-50"
                    key={user.id}
                    onClick={() => void startSearchThread(user)}
                  >
                    <Avatar name={user.display_name} />
                    <UserText displayName={user.display_name} username={user.username} />
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {orderedConversations.length === 0 ? (
              <EmptySidebar />
            ) : (
              orderedConversations.map((conversation) => (
                <button
                  className={`flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 ${
                    activeThread && partnerId(activeThread) === conversation.user_id ? "bg-teal-50" : ""
                  }`}
                  key={conversation.user_id}
                  onClick={() => void openThread(conversation)}
                >
                  <Avatar name={conversation.display_name} />
                  <div className="min-w-0 flex-1">
                    <UserText displayName={conversation.display_name} username={conversation.username} />
                    <p className="mt-1 truncate text-xs text-slate-500">
                      {conversation.last_message_at ? new Date(conversation.last_message_at).toLocaleString() : "No messages yet"}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="flex min-h-0 flex-col">
          {activeThread ? (
            <>
              <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar name={activePartnerName} />
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold">{activePartnerName}</h2>
                    <p className="flex items-center gap-1 text-xs text-slate-500">
                      <ShieldCheck className="h-3.5 w-3.5 text-signal" />
                      E2EE active
                    </p>
                  </div>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5">
                {loadingMessages ? <p className="text-sm text-slate-500">Decrypting message history...</p> : null}
                {!loadingMessages && messages.length === 0 ? (
                  <div className="mx-auto mt-20 max-w-sm text-center text-sm text-slate-500">
                    <MessageSquarePlus className="mx-auto mb-3 h-9 w-9 text-slate-400" />
                    Start with a message. It will be encrypted before it leaves this device.
                  </div>
                ) : null}
                <div className="space-y-3">
                  {messages.map((message) => (
                    <MessageBubble key={message.id} message={message} mine={message.from_user_id === session.user.id} />
                  ))}
                </div>
              </div>

              {error ? <p className="mx-4 mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
              <form className="flex shrink-0 gap-3 border-t border-slate-200 bg-white p-3" onSubmit={sendMessage}>
                <input
                  className="h-11 min-w-0 flex-1 rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-signal focus:ring-2 focus:ring-teal-100"
                  placeholder="Write an encrypted message"
                  value={messageText}
                  maxLength={4000}
                  onChange={(event) => setMessageText(event.target.value)}
                />
                <Button type="submit" loading={sending} title="Send encrypted message" aria-label="Send encrypted message">
                  <Send className="h-4 w-4" />
                </Button>
              </form>
            </>
          ) : (
            <div className="grid min-h-0 flex-1 place-items-center px-6 text-center">
              <div className="max-w-md">
                <Search className="mx-auto mb-4 h-10 w-10 text-slate-400" />
                <h2 className="text-xl font-semibold">Choose someone to message</h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  Search for a user or open an existing conversation. Plaintext appears only after local decryption.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function mergeMessages(messages: DecryptedMessage[]): DecryptedMessage[] {
  const byId = new Map<string, DecryptedMessage>();
  for (const message of messages) byId.set(message.id, message);
  return [...byId.values()].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

function cryptoRandomId(): string {
  return crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
}

function Avatar({ name }: { name: string }) {
  return (
    <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-slate-900 text-sm font-semibold text-white">
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}

function UserText({ displayName, username }: { displayName: string; username: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-sm font-semibold">{displayName}</p>
      <p className="truncate text-xs text-slate-500">@{username}</p>
    </div>
  );
}

function EmptySidebar() {
  return (
    <div className="px-5 py-10 text-center text-sm text-slate-500">
      <LockKeyhole className="mx-auto mb-3 h-8 w-8 text-slate-400" />
      No conversations yet. Search for another WhisperBox user to start one.
    </div>
  );
}

function MessageBubble({ message, mine }: { message: DecryptedMessage; mine: boolean }) {
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[78%] rounded-lg px-3 py-2 text-sm shadow-sm ${
          mine ? "bg-signal text-white" : "border border-slate-200 bg-white text-ink"
        } ${message.decryptError ? "border-red-200 bg-red-50 text-red-700" : ""}`}
      >
        <p className="whitespace-pre-wrap break-words leading-6">{message.plaintext}</p>
        <p className={`mt-1 flex items-center gap-1 text-[11px] ${mine && !message.decryptError ? "text-teal-50" : "text-slate-500"}`}>
          {message.decryptError || message.deliveryError ? <ShieldAlert className="h-3 w-3" /> : <ShieldCheck className="h-3 w-3" />}
          {message.deliveryError ??
            (message.pending
              ? "Encrypting delivery"
              : new Date(message.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}
        </p>
      </div>
    </div>
  );
}
