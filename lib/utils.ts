import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Fixed: changed PUBLISHABLE_KEY to ANON_KEY to match .env.local
export const hasEnvVars =
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;