"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { HardDrive, LogOut, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";

type UserState = {
  email: string;
} | null;

export function UserMenu() {
  const [user, setUser] = useState<UserState>(null);
  const [mode, setMode] = useState<"local" | "supabase" | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    let isMounted = true;
    let unsubscribe: (() => void) | undefined;

    async function loadMode() {
      const response = await fetch("/api/settings", { cache: "no-store" });
      if (!response.ok) {
        return null;
      }

      const payload = (await response.json()) as {
        mode?: "local" | "supabase";
      };
      return payload.mode ?? null;
    }

    async function loadCloudUser() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!isMounted) return;
      setUser(user?.email ? { email: user.email } : null);
      setIsLoading(false);

      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((_event, session) => {
        if (!isMounted) return;
        setUser(session?.user.email ? { email: session.user.email } : null);
      });
      unsubscribe = () => subscription.unsubscribe();
    }

    void loadMode()
      .then((nextMode) => {
        if (!isMounted) return;
        setMode(nextMode);
        if (nextMode === "local") {
          setIsLoading(false);
          return;
        }
        return loadCloudUser();
      })
      .catch(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
      unsubscribe?.();
    };
  }, []);

  const initials = useMemo(() => {
    if (!user?.email) {
      return "";
    }

    return user.email.slice(0, 1).toUpperCase();
  }, [user?.email]);

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    setUser(null);
    router.push("/");
  }

  if (isLoading) {
    return (
      <div className="flex size-11 items-center justify-center rounded-full bg-[var(--color-surface-container)]">
        <UserRound className="size-4 text-[var(--color-text-tertiary)]" />
      </div>
    );
  }

  if (mode === "local") {
    return (
      <Link
        className="flex size-11 items-center justify-center rounded-full bg-white text-[var(--color-text-secondary)] shadow-sm ring-1 ring-[var(--color-border)] transition hover:bg-[var(--color-surface-container-low)]"
        href="/settings"
        title="本地模式"
      >
        <HardDrive className="size-5" />
      </Link>
    );
  }

  if (!user) {
    return (
      <Link
        className="flex size-11 items-center justify-center rounded-full bg-[var(--color-surface-container)] text-sm font-medium text-[var(--color-text-secondary)] transition hover:bg-[var(--color-surface-container-high)]"
        href="/auth/login"
        title="登录"
      >
        头像
      </Link>
    );
  }

  return (
    <div className="group relative">
      <div
        className="flex size-11 items-center justify-center rounded-full bg-white text-sm font-medium text-[var(--color-text-secondary)] shadow-sm ring-1 ring-[var(--color-border)]"
        title={user.email}
      >
        {initials}
      </div>
      <button
        className="absolute right-0 top-12 hidden items-center gap-2 whitespace-nowrap rounded-md border border-[var(--color-border)] bg-[var(--color-surface-container-lowest)] px-3 py-2 text-sm text-[var(--color-text-secondary)] shadow-md group-hover:flex"
        onClick={handleLogout}
        type="button"
      >
        <LogOut className="size-4" />
        退出登录
      </button>
    </div>
  );
}
