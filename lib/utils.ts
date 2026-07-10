import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const hasEnvVars =
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export function isLocalStorageMode(env: NodeJS.ProcessEnv = process.env) {
  if (env.ZENME_STORAGE_DRIVER) {
    return env.ZENME_STORAGE_DRIVER === "local";
  }

  return !(
    env.NEXT_PUBLIC_SUPABASE_URL &&
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}

export function canBypassMissingSupabaseEnv(env: NodeJS.ProcessEnv = process.env) {
  return (
    env.NODE_ENV !== "production" &&
    (!env.VERCEL_ENV || env.VERCEL_ENV === "development")
  );
}
