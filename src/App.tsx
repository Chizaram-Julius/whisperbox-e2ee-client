import { useEffect, useMemo, useState } from "react";
import { LockKeyhole, MessageCircle } from "lucide-react";
import { AuthPanel } from "./components/auth/AuthPanel";
import { ChatShell } from "./components/chat/ChatShell";
import { Button } from "./components/ui/Button";
import { Input } from "./components/ui/Input";
import { login as apiLogin, logout as apiLogout, register as apiRegister, setMemoryAccessToken } from "./lib/api";
import {
  deriveWrappingKey,
  exportPublicKeyBase64,
  generatePBKDF2Salt,
  generateRSAKeyPair,
  unwrapPrivateKey,
  wrapPrivateKey,
} from "./lib/crypto";
import { clearSession, getSession, saveSession, type StoredSession } from "./lib/storage";
import type { UserProfile } from "./types/api";

export type CryptoIdentity = {
  privateKey: CryptoKey;
  publicKeyBase64: string;
};

export type AuthState =
  | { status: "loading" }
  | { status: "signed-out" }
  | { status: "locked"; session: StoredSession }
  | { status: "signed-in"; session: StoredSession; crypto: CryptoIdentity };

function expiresAt(expiresIn: number): number {
  return Date.now() + expiresIn * 1000;
}

export function App() {
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });
  const [unlockPassword, setUnlockPassword] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const [unlocking, setUnlocking] = useState(false);

  useEffect(() => {
    void getSession().then((session) => {
      if (!session) {
        setAuth({ status: "signed-out" });
        return;
      }
      setMemoryAccessToken(session.accessToken);
      setAuth({ status: "locked", session });
    });
  }, []);

  const authActions = useMemo(
    () => ({
      register: async (input: { username: string; displayName: string; password: string }) => {
        const keyPair = await generateRSAKeyPair();
        const salt = generatePBKDF2Salt();
        const wrappingKey = await deriveWrappingKey(input.password, salt);
        const publicKey = await exportPublicKeyBase64(keyPair.publicKey);
        const wrappedPrivateKey = await wrapPrivateKey(keyPair.privateKey, wrappingKey);
        const privateKey = await unwrapPrivateKey(wrappedPrivateKey, wrappingKey);

        const response = await apiRegister({
          username: input.username,
          display_name: input.displayName,
          password: input.password,
          public_key: publicKey,
          wrapped_private_key: wrappedPrivateKey,
          pbkdf2_salt: salt,
        });
        const session = {
          accessToken: response.access_token,
          refreshToken: response.refresh_token,
          expiresAt: expiresAt(response.expires_in),
          user: response.user,
        };
        await saveSession(session);
        setMemoryAccessToken(response.access_token);
        setAuth({ status: "signed-in", session, crypto: { privateKey, publicKeyBase64: publicKey } });
      },
      login: async (input: { username: string; password: string }) => {
        const response = await apiLogin({ username: input.username, password: input.password });
        const privateKey = await restorePrivateKey(response.user, input.password);
        const session = {
          accessToken: response.access_token,
          refreshToken: response.refresh_token,
          expiresAt: expiresAt(response.expires_in),
          user: response.user,
        };
        await saveSession(session);
        setMemoryAccessToken(response.access_token);
        setAuth({
          status: "signed-in",
          session,
          crypto: { privateKey, publicKeyBase64: response.user.public_key },
        });
      },
    }),
    [],
  );

  async function restorePrivateKey(user: UserProfile, password: string): Promise<CryptoKey> {
    try {
      const wrappingKey = await deriveWrappingKey(password, user.pbkdf2_salt);
      return await unwrapPrivateKey(user.wrapped_private_key, wrappingKey);
    } catch {
      throw new Error("Could not unlock your private key. Check the password and try again.");
    }
  }

  async function unlockSession() {
    if (auth.status !== "locked") return;
    setUnlockError("");
    setUnlocking(true);
    try {
      const privateKey = await restorePrivateKey(auth.session.user, unlockPassword);
      setAuth({
        status: "signed-in",
        session: auth.session,
        crypto: { privateKey, publicKeyBase64: auth.session.user.public_key },
      });
      setUnlockPassword("");
    } catch (error) {
      setUnlockError(error instanceof Error ? error.message : "Unlock failed.");
    } finally {
      setUnlocking(false);
    }
  }

  async function logout() {
    const session = auth.status === "signed-in" || auth.status === "locked" ? auth.session : null;
    if (session) {
      try {
        await apiLogout(session.refreshToken);
      } catch {
        // Local logout still clears tokens and in-memory keys if the server is unreachable.
      }
    }
    await clearSession();
    setMemoryAccessToken(null);
    setAuth({ status: "signed-out" });
  }

  if (auth.status === "loading") {
    return (
      <main className="grid min-h-screen place-items-center bg-paper text-ink">
        <div className="flex items-center gap-3 text-sm text-slate-600">
          <MessageCircle className="h-5 w-5 animate-pulse text-signal" />
          Loading secure workspace
        </div>
      </main>
    );
  }

  if (auth.status === "signed-out") {
    return <AuthPanel onLogin={authActions.login} onRegister={authActions.register} />;
  }

  if (auth.status === "locked") {
    return (
      <main className="grid min-h-screen place-items-center bg-paper px-4 text-ink">
        <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-panel">
          <div className="mb-5 flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-lg bg-teal-50 text-signal">
              <LockKeyhole className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-semibold">Unlock WhisperBox</h1>
              <p className="text-sm text-slate-500">Your private key is wrapped. Enter your password to decrypt locally.</p>
            </div>
          </div>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void unlockSession();
            }}
          >
            <Input
              label="Password"
              type="password"
              value={unlockPassword}
              minLength={8}
              onChange={(event) => setUnlockPassword(event.target.value)}
              required
            />
            {unlockError ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{unlockError}</p> : null}
            <div className="flex gap-3">
              <Button type="submit" loading={unlocking} className="flex-1">
                Unlock
              </Button>
              <Button type="button" variant="secondary" onClick={() => void logout()}>
                Logout
              </Button>
            </div>
          </form>
        </section>
      </main>
    );
  }

  return <ChatShell session={auth.session} crypto={auth.crypto} onLogout={() => void logout()} />;
}
