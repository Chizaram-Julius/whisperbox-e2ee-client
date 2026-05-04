import { LogOut, ShieldCheck } from "lucide-react";
import { Button } from "../ui/Button";
import type { StoredSession } from "../../lib/storage";

type TopBarProps = {
  session: StoredSession;
  connection: "connecting" | "connected" | "disconnected";
  onLogout: () => void;
};

export function TopBar({ session, connection, onLogout }: TopBarProps) {
  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-lg bg-teal-50 text-signal">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{session.user.display_name}</p>
          <p className="truncate text-xs text-slate-500">@{session.user.username} · {connection}</p>
        </div>
      </div>
      <Button variant="ghost" onClick={onLogout} title="Logout" aria-label="Logout">
        <LogOut className="h-5 w-5" />
      </Button>
    </header>
  );
}
