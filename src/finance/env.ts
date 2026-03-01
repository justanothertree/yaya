type ViteEnv = Record<string, string | undefined>

function readViteEnv(): ViteEnv {
  // Avoid direct `import.meta.env` typing issues across TS configs.
  return ((import.meta as unknown as { env?: ViteEnv }).env ?? {}) as ViteEnv
}

export type FinanceEnv = {
  supabaseUrl: string
  supabaseAnonKey: string
}

/** True if the frontend Supabase env vars are present (does not validate values). */
export function hasFinanceSupabaseEnv(): boolean {
  const env = readViteEnv()
  return !!env.VITE_SUPABASE_URL && !!env.VITE_SUPABASE_ANON_KEY
}

/**
 * Non-throwing env getter for optional features.
 * Returns null when Supabase is not configured for this build.
 */
export function tryGetFinanceEnv(): FinanceEnv | null {
  const env = readViteEnv()
  const supabaseUrl = env.VITE_SUPABASE_URL
  const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) return null
  return { supabaseUrl, supabaseAnonKey }
}

/**
 * Finance modules are frontend-only and intentionally use the Supabase anon key.
 * Security must come from Auth (JWT) + RLS policies in Supabase.
 */
export function getFinanceEnv(): FinanceEnv {
  const env = readViteEnv()
  const supabaseUrl = env.VITE_SUPABASE_URL
  const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      '[finance] Missing Supabase env. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (build-time).',
    )
  }

  return { supabaseUrl, supabaseAnonKey }
}
