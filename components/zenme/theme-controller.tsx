"use client";

import { useEffect } from "react";

import type { ZenmeTheme } from "@/lib/local/settings";

export const ZENME_THEME_CHANGE_EVENT = "zenme-theme-change";

export function applyThemePreference(theme: ZenmeTheme) {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolvedTheme = theme === "system" ? (prefersDark ? "dark" : "light") : theme;
  document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = resolvedTheme;
  try {
    window.localStorage.setItem("zenme.theme.v1", theme);
  } catch {
    // The persisted settings remain authoritative when storage is unavailable.
  }
}

export function announceThemePreference(theme: ZenmeTheme) {
  applyThemePreference(theme);
  window.dispatchEvent(
    new CustomEvent<ZenmeTheme>(ZENME_THEME_CHANGE_EVENT, { detail: theme }),
  );
}

export function ThemeController() {
  useEffect(() => {
    const cachedTheme = document.documentElement.dataset.theme;
    let theme: ZenmeTheme =
      cachedTheme === "dark" || cachedTheme === "warm" || cachedTheme === "system"
        ? cachedTheme
        : "light";
    let userChanged = false;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => applyThemePreference(theme);
    const handleThemeChange = (event: Event) => {
      userChanged = true;
      theme = (event as CustomEvent<ZenmeTheme>).detail;
      apply();
    };

    apply();
    media.addEventListener("change", apply);
    window.addEventListener(ZENME_THEME_CHANGE_EVENT, handleThemeChange);
    void fetch("/api/settings", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((payload: { settings?: { theme?: unknown } } | null) => {
        const persistedTheme = payload?.settings?.theme;
        if (
          userChanged ||
          (persistedTheme !== "light" &&
            persistedTheme !== "dark" &&
            persistedTheme !== "warm" &&
            persistedTheme !== "system")
        ) {
          return;
        }
        theme = persistedTheme;
        apply();
      })
      .catch(() => undefined);
    return () => {
      media.removeEventListener("change", apply);
      window.removeEventListener(ZENME_THEME_CHANGE_EVENT, handleThemeChange);
    };
  }, []);

  return null;
}
