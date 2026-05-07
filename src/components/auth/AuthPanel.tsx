import { FormEvent, useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";
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

  function switchMode(nextMode: "login" | "register") {
    if (nextMode === mode) return;
    setMode(nextMode);
    setUsername("");
    setDisplayName("");
    setPassword("");
    setError("");
  }

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
      setError(getAuthErrorMessage(error, mode));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="grid min-h-[100svh] place-items-center bg-paper px-4 py-8 text-ink">
      <section className="w-full max-w-lg">
        <div className="mx-auto mb-7 flex w-full max-w-md items-center justify-center gap-3">
          <div className="relative grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-slate-950 text-base font-bold tracking-normal text-white shadow-sm">
            WB
            <span className="absolute -bottom-1 -right-1 grid h-6 w-6 place-items-center rounded-md border-2 border-paper bg-teal-50 text-signal">
              <ShieldCheck className="h-3.5 w-3.5" />
            </span>
          </div>
          <div className="min-w-0 text-left">
            <p className="text-lg font-bold uppercase tracking-wide text-signal-dark">WhisperBox</p>
            <p className="mt-1 text-base leading-6 text-slate-600">E2EE client for https://whisperbox.koyeb.app</p>
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-panel sm:p-6">
          <div className="mb-4 flex rounded-md bg-slate-100 p-1">
            <button
              className={`h-11 flex-1 rounded-md text-base font-semibold ${mode === "login" ? "bg-white text-ink shadow-sm" : "text-slate-500"}`}
              onClick={() => switchMode("login")}
              type="button"
            >
              Login
            </button>
            <button
              className={`h-11 flex-1 rounded-md text-base font-semibold ${mode === "register" ? "bg-white text-ink shadow-sm" : "text-slate-500"}`}
              onClick={() => switchMode("register")}
              type="button"
            >
              Register
            </button>
          </div>

          <form className="space-y-4" onSubmit={submit}>
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
            <Button className="h-12 w-full text-base" loading={loading} type="submit">
              <KeyRound className="h-4 w-4" />
              {mode === "login" ? "Sign in" : "Sign up"}
            </Button>
          </form>
        </div>
      </section>
    </main>
  );
}

function getAuthErrorMessage(error: unknown, mode: "login" | "register"): string {
  const message = error instanceof Error ? error.message : "";

  if (message.toLowerCase().includes("internal server error")) {
    return mode === "login"
      ? "WhisperBox login returned 500 from the remote backend. Try again in a moment, then confirm your username and password."
      : "WhisperBox /auth/register is returning 500 from the remote backend. No plaintext private key was sent; try again when the API is healthy.";
  }

  return message || "Authentication failed.";
}
