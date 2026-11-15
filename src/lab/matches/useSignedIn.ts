import { useEffect, useState } from 'react'
import { onAuthStateChange, peekPersistedUserId } from '../../finance/auth'
import { hasFinanceSupabaseEnv } from '../../finance/env'

/**
 * Whether somebody is signed in, for a toy that has no `viewer` handed to it. A first answer from
 * the persisted session (no network), then the auth listener's. A stale "yes" only shows a button
 * the server will refuse: every match RPC asks `auth.uid()` itself.
 */
export function useSignedIn(): boolean {
  const [yes, setYes] = useState(() => hasFinanceSupabaseEnv() && !!peekPersistedUserId())
  useEffect(() => {
    if (!hasFinanceSupabaseEnv()) return
    const { data } = onAuthStateChange((_event, session) => setYes(!!session?.user))
    return () => data.subscription.unsubscribe()
  }, [])
  return yes
}
