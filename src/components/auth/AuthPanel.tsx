import { FormEvent, ReactNode, useState } from "react";
import { Fingerprint, KeyRound, Lock, MessageCircle, Radio, ShieldCheck, Sparkles } from "lucide-react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";

type AuthPanelProps = {
  onLogin: (input: { username: string; password: string }) => Promise<void>;
  onRegister: (input: { username: string; displayName: string; password: string }) => Promise<void>;
};

export function AuthPanel({ onLogin, onRegister }: AuthPanelProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");

    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(username) && mode === "register") {
      setError("Username must be 3-32 characters and use letters, numbers, underscores, or hyphens.");
      return;
    }

    if (mode === "register" && password.length < 8) {
      setError("Password must be at least 8 characters so it can wrap your private key.");
      return;
    }

    setLoading(true);
    try {
      if (mode === "login") {
        await onLogin({ username: username.trim(), password });
      } else {
        await onRegister({ username: username.trim(), displayName: displayName.trim(), password });
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-[100svh] overflow-x-hidden bg-paper text-ink">
      <div className="mx-auto grid min-h-[100svh] w-full max-w-6xl items-center gap-7 px-5 py-6 lg:grid-cols-[1.02fr_0.98fr]">
        <section className="max-w-2xl">
          <div className="mb-6 flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-lg bg-slate-950 text-white shadow-sm">
              <Lock className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-signal-dark">WhisperBox</p>
              <p className="text-sm text-slate-500">E2EE client for the WhisperBox API</p>
            </div>
          </div>

          <h1 className="max-w-xl text-4xl font-semibold leading-[1.05] tracking-normal text-slate-950 sm:text-5xl">
            Encrypted chat, decrypted only by people.
          </h1>
          <p className="mt-4 max-w-xl text-base leading-7 text-slate-600">
            The browser generates keys, wraps the private key, encrypts each message with AES-GCM, and sends only
            ciphertext to https://whisperbox.koyeb.app.
          </p>

          <div className="mt-5 flex flex-wrap gap-2">
            <StatusPill icon={<ShieldCheck className="h-4 w-4" />} label="E2EE active" />
            <StatusPill icon={<Radio className="h-4 w-4" />} label="WSS realtime" />
            <StatusPill icon={<Fingerprint className="h-4 w-4" />} label="Private key stays client-side" />
          </div>

          <div className="mt-7 grid gap-3 sm:grid-cols-3">
            <SecurityCard
              tone="teal"
              title="Client-side RSA"
              copy="RSA-OAEP 2048 keypair is generated before registration."
            />
            <SecurityCard
              tone="blue"
              title="AES-GCM payloads"
              copy="Fresh message keys and 96-bit IVs protect every send."
            />
            <SecurityCard
              tone="amber"
              title="Wrapped private key"
              copy="PBKDF2 derives an AES-KW key from the account password."
            />
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-panel sm:p-5">
          <div className="mb-4 overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
            <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3">
              <div className="flex items-center gap-3">
                <div className="grid h-9 w-9 place-items-center rounded-md bg-slate-950 text-white">
                  <MessageCircle className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold">Secure channel</p>
                  <p className="text-xs text-slate-500">https://whisperbox.koyeb.app</p>
                </div>
              </div>
              <div className="flex items-center gap-1 rounded-md bg-teal-50 px-2 py-1 text-xs font-semibold text-signal-dark">
                <ShieldCheck className="h-3.5 w-3.5" />
                Locked
              </div>
            </div>
            <div className="space-y-2 px-4 py-4 text-sm">
              <div className="ml-auto max-w-[82%] rounded-lg bg-signal px-3 py-2 text-white shadow-sm">
                ciphertext: 6fA9...t2pQ
              </div>
              <div className="max-w-[86%] rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-600 shadow-sm">
                encryptedKey: RSA-OAEP
              </div>
              <div className="ml-auto flex max-w-max items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">
                <Sparkles className="h-3.5 w-3.5" />
                No plaintext payload
              </div>
            </div>
          </div>

          <div className="mb-4 flex rounded-md bg-slate-100 p-1">
            <button
              className={`h-9 flex-1 rounded-md text-sm font-medium ${mode === "login" ? "bg-white text-ink shadow-sm" : "text-slate-500"}`}
              onClick={() => setMode("login")}
              type="button"
            >
              Login
            </button>
            <button
              className={`h-9 flex-1 rounded-md text-sm font-medium ${mode === "register" ? "bg-white text-ink shadow-sm" : "text-slate-500"}`}
              onClick={() => setMode("register")}
              type="button"
            >
              Register
            </button>
          </div>

          <form className="space-y-3.5" onSubmit={submit}>
            <Input
              label="Username"
              value={username}
              minLength={mode === "register" ? 3 : 1}
              maxLength={32}
              autoComplete="username"
              onChange={(event) => setUsername(event.target.value)}
              required
            />
            {mode === "register" ? (
              <Input
                label="Display name"
                value={displayName}
                minLength={1}
                maxLength={128}
                autoComplete="name"
                onChange={(event) => setDisplayName(event.target.value)}
                required
              />
            ) : null}
            <Input
              label="Password"
              type="password"
              value={password}
              minLength={mode === "register" ? 8 : 1}
              maxLength={128}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
            {error ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
            <Button className="h-11 w-full" loading={loading} type="submit">
              <KeyRound className="h-4 w-4" />
              {mode === "login" ? "Decrypt session" : "Create encrypted account"}
            </Button>
          </form>
        </section>
      </div>
    </main>
  );
}

function StatusPill({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-teal-100 bg-white px-3 py-2 text-sm font-medium text-signal-dark shadow-sm">
      {icon}
      <span>{label}</span>
    </div>
  );
}

function SecurityCard({ title, copy, tone }: { title: string; copy: string; tone: "teal" | "blue" | "amber" }) {
  const tones = {
    teal: "bg-teal-50 text-signal border-teal-100",
    blue: "bg-sky-50 text-sky-700 border-sky-100",
    amber: "bg-amber-50 text-amber-700 border-amber-100",
  };

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className={`mb-3 grid h-8 w-8 place-items-center rounded-md border ${tones[tone]}`}>
        <ShieldCheck className="h-4 w-4" />
      </div>
      <h2 className="text-sm font-semibold">{title}</h2>
      <p className="mt-1 text-sm leading-6 text-slate-600">{copy}</p>
    </div>
  );
}
