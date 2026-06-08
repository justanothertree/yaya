import { useEffect, useMemo, useState } from 'react'
import type { AllocationRow, ExecutedTradeRow, FamilyAccountRow } from '../finance/tables'
import { getSession, onAuthStateChange } from '../finance/auth'
import { getSupabaseClient } from '../finance/client'
import type {
  InsertAllocationPayloadCanonical,
  InsertAllocationRpcArgsCanonical,
  InsertExecutedTradePayloadCanonical,
  InsertExecutedTradeRpcArgsCanonical,
  InsertFamilyAccountPayloadCanonical,
  InsertFamilyAccountRpcArgsCanonical,
  ScheduleTradeEvenSplitPayloadCanonical,
  ScheduleTradeEvenSplitRpcArgsCanonical,
  InsertTradeEvenSplitPayloadCanonical,
  InsertTradeEvenSplitRpcArgsCanonical,
} from '../finance/rpcPayloads'

type MaybeError = { message?: string } | null | undefined

function safeMsg(err: unknown) {
  const msg = (err as MaybeError)?.message
  return typeof msg === 'string' && msg ? msg : String(err)
}

function explainInvestmentsError(err: unknown) {
  const msg = safeMsg(err)
  if (/schema must be one of the following:\s*public,\s*graphql_public/i.test(msg)) {
    return [
      'Database API schema is restricted to public/graphql_public.',
      'Use only public RPCs from docs/supabase-rpcs.sql (do not query finance.* directly via schema).',
      `Raw: ${msg}`,
    ].join(' ')
  }
  if (/function\s+public\.(get_family_accounts|get_executed_trades|get_allocations|insert_trade_even_split)/i.test(msg)) {
    return [
      'Required finance RPCs are missing in Supabase.',
      'Run the SQL in docs/supabase-rpcs.sql in your Supabase SQL editor, then refresh.',
      `Raw: ${msg}`,
    ].join(' ')
  }
  return msg
}

type PostgrestResult<T> = { data: T | null; error: unknown | null }

const INVESTMENTS_ENABLE_LOGS =
  import.meta.env.DEV &&
  (import.meta.env as unknown as { VITE_FINANCE_DEBUG_LOGS?: unknown }).VITE_FINANCE_DEBUG_LOGS ===
    '1'

function logCallStart(meta: Record<string, unknown>) {
  if (!INVESTMENTS_ENABLE_LOGS) return
  console.info('[investments][supabase] start', meta)
}

function logCallOk(meta: Record<string, unknown>) {
  if (!INVESTMENTS_ENABLE_LOGS) return
  console.info('[investments][supabase] ok', meta)
}

function logCallError(meta: Record<string, unknown>, error: unknown) {
  if (!INVESTMENTS_ENABLE_LOGS) return
  console.error('[investments][supabase] error', meta, error)
}

function rowCount(data: unknown): number {
  if (!data) return 0
  if (Array.isArray(data)) return data.length
  return 1
}

function fmtMoney(n: number) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
    }).format(n)
  } catch {
    return `$${n.toFixed(2)}`
  }
}

function fmtDate(iso: string) {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return iso
    return d.toLocaleString()
  } catch {
    return iso
  }
}

function pickString(obj: unknown, keys: string[]): string {
  if (!obj || typeof obj !== 'object') return ''
  const rec = obj as Record<string, unknown>
  for (const k of keys) {
    const v = rec[k]
    if (typeof v === 'string' && v.trim()) return v
  }
  return ''
}

function pickNumber(obj: unknown, keys: string[]): number | null {
  if (!obj || typeof obj !== 'object') return null
  const rec = obj as Record<string, unknown>
  for (const k of keys) {
    const v = rec[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
    if (typeof v === 'string' && v.trim()) {
      const n = Number(v)
      if (Number.isFinite(n)) return n
    }
  }
  return null
}

function decodeJwtPayload(accessToken: string | null | undefined): Record<string, unknown> | null {
  if (!accessToken) return null
  const parts = accessToken.split('.')
  if (parts.length < 2) return null
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const pad = '='.repeat((4 - (b64.length % 4)) % 4)
    const json = atob(b64 + pad)
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return null
  }
}

function isDevNodeEnv(): boolean {
  // Vite doesn't guarantee `process.env.NODE_ENV` exists in the browser bundle.
  // Guard to avoid runtime errors, but keep the intent: render only in development.
  const nodeEnv =
    typeof (globalThis as unknown as { process?: { env?: { NODE_ENV?: unknown } } }).process !==
      'undefined'
      ? (globalThis as unknown as { process?: { env?: { NODE_ENV?: unknown } } }).process?.env
          ?.NODE_ENV
      : null

  return nodeEnv === 'development' || import.meta.env.DEV
}

function InvestmentsJwtDebugStrip({ enabled }: { enabled: boolean }) {
  const [jwtUserId, setJwtUserId] = useState<string | null>(null)
  const [jwtRole, setJwtRole] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    if (!isDevNodeEnv()) return

    let alive = true
    const sb = getSupabaseClient()

    async function refresh() {
      const { data, error } = await sb.auth.getSession()
      if (error) {
        if (!alive) return
        setJwtUserId(null)
        setJwtRole(null)
        return
      }

      const accessToken = data.session?.access_token
      const payload = decodeJwtPayload(accessToken)
      const role = typeof payload?.role === 'string' ? (payload.role as string) : null

      // Supabase JWTs commonly use `sub` for the user id.
      const sub = typeof payload?.sub === 'string' ? (payload.sub as string) : null
      const userId =
        sub || (typeof payload?.user_id === 'string' ? (payload.user_id as string) : null)

      if (!alive) return
      setJwtRole(role)
      setJwtUserId(userId)
    }

    void refresh()

    const { data: sub } = sb.auth.onAuthStateChange(() => {
      void refresh()
    })

    return () => {
      alive = false
      sub.subscription.unsubscribe()
    }
  }, [enabled])

  if (!enabled) return null
  if (!isDevNodeEnv()) return null

  return (
    <article
      className="card"
      style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}
    >
      <strong style={{ fontSize: 13 }}>JWT</strong>
      <span className="muted" style={{ fontSize: 12 }}>
        user_id: {jwtUserId ?? '—'}
      </span>
      <span className="muted" style={{ fontSize: 12 }}>
        role: {jwtRole ?? '—'}
      </span>
    </article>
  )
}

function coerceBalance(balances: unknown): { value: number | null; label: string } {
  if (typeof balances === 'number' && Number.isFinite(balances))
    return { value: balances, label: fmtMoney(balances) }
  if (balances && typeof balances === 'object') {
    const obj = balances as Record<string, unknown>
    const candidates = ['balance', 'current', 'current_balance', 'available', 'total']
    for (const k of candidates) {
      const v = obj[k]
      if (typeof v === 'number' && Number.isFinite(v)) return { value: v, label: fmtMoney(v) }
    }
    try {
      const s = JSON.stringify(balances)
      return { value: null, label: s.length > 80 ? s.slice(0, 77) + '…' : s }
    } catch {
      return { value: null, label: String(balances) }
    }
  }
  if (typeof balances === 'string' && balances.trim()) return { value: null, label: balances }
  return { value: null, label: '—' }
}

function parseCsvLines(text: string): string[][] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  const out: string[][] = []
  for (const line of lines) {
    const row: string[] = []
    let cur = ''
    let inQuotes = false
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i]
      if (ch === '"') {
        const next = line[i + 1]
        if (inQuotes && next === '"') {
          cur += '"'
          i += 1
          continue
        }
        inQuotes = !inQuotes
        continue
      }
      if (ch === ',' && !inQuotes) {
        row.push(cur.trim())
        cur = ''
        continue
      }
      cur += ch
    }
    row.push(cur.trim())
    out.push(row)
  }
  return out
}

function parseAccountsCsv(text: string): string[] {
  const rows = parseCsvLines(text)
  if (rows.length === 0) return []

  const firstRow = rows[0].map((c) => c.toLowerCase())
  const hasHeader = firstRow.some((c) => c.includes('name') || c.includes('account'))
  const body = hasHeader ? rows.slice(1) : rows

  const names = body
    .map((r) => (r[0] ?? '').trim())
    .filter(Boolean)

  const dedup = new Set<string>()
  const out: string[] = []
  for (const n of names) {
    const key = n.toLowerCase()
    if (dedup.has(key)) continue
    dedup.add(key)
    out.push(n)
  }
  return out
}

type ParsedTradeRow = {
  symbol: string
  assetType: string
  platform: string
  executionTime?: string
  unitsAcquired: number
  price: number
  fee: number
  useEvenSplit: boolean
  scheduleAt?: string
}

function parseTradesCsv(text: string): ParsedTradeRow[] {
  const rows = parseCsvLines(text)
  if (rows.length === 0) return []

  const headers = rows[0].map((c) => c.trim().toLowerCase())
  const hasHeader = headers.some((h) =>
    [
      'symbol',
      'asset_symbol',
      'units',
      'units_acquired',
      'price',
      'execution_time',
      'schedule_at',
    ].includes(h),
  )

  const body = hasHeader ? rows.slice(1) : rows
  const get = (row: string[], ...keys: string[]) => {
    if (!hasHeader) return ''
    for (const k of keys) {
      const idx = headers.indexOf(k)
      if (idx >= 0) return (row[idx] ?? '').trim()
    }
    return ''
  }

  const out: ParsedTradeRow[] = []
  for (const row of body) {
    const symbol = hasHeader ? get(row, 'asset_symbol', 'symbol', 'ticker') : (row[0] ?? '').trim()
    const unitsRaw = hasHeader ? get(row, 'units_acquired', 'units', 'quantity', 'qty') : (row[1] ?? '').trim()
    const priceRaw = hasHeader ? get(row, 'price') : (row[2] ?? '').trim()
    const feeRaw = hasHeader ? get(row, 'fee') : (row[3] ?? '').trim()
    const executionTime = hasHeader
      ? get(row, 'execution_time', 'executed_at', 'when')
      : (row[4] ?? '').trim()
    const assetType = hasHeader ? get(row, 'asset_type', 'type') : (row[5] ?? '').trim()
    const platform = hasHeader ? get(row, 'platform') : (row[6] ?? '').trim()
    const evenRaw = hasHeader ? get(row, 'even_split', 'use_even_split') : (row[7] ?? '').trim()
    const scheduleAt = hasHeader ? get(row, 'schedule_at') : (row[8] ?? '').trim()

    if (!symbol) continue

    const unitsAcquired = Number(unitsRaw)
    const price = Number(priceRaw)
    const fee = feeRaw ? Number(feeRaw) : 0
    if (!Number.isFinite(unitsAcquired) || unitsAcquired <= 0) continue
    if (!Number.isFinite(price) || price <= 0) continue
    if (!Number.isFinite(fee) || fee < 0) continue

    const even = !evenRaw || /^(1|true|yes|y)$/i.test(evenRaw)

    out.push({
      symbol,
      assetType: assetType || 'stock',
      platform,
      executionTime: executionTime || undefined,
      unitsAcquired,
      price,
      fee,
      useEvenSplit: even,
      scheduleAt: scheduleAt || undefined,
    })
  }

  return out
}

export function Investments() {
  const devEnabled = import.meta.env.DEV

  const [userId, setUserId] = useState<string | null>(null)
  const [userEmail, setUserEmail] = useState<string | null>(null)

  const [accounts, setAccounts] = useState<FamilyAccountRow[]>([])
  const [trades, setTrades] = useState<ExecutedTradeRow[]>([])
  const [allocs, setAllocs] = useState<AllocationRow[]>([])

  const [loadingAccounts, setLoadingAccounts] = useState(false)
  const [loadingTrades, setLoadingTrades] = useState(false)
  const [loadingAllocs, setLoadingAllocs] = useState(false)

  const [error, setError] = useState<string | null>(null)

  // DEV-only test controls
  const [devBusy, setDevBusy] = useState(false)
  const [devAccountName, setDevAccountName] = useState('[DEV] Test Account')
  const [devLastFamilyAccountId, setDevLastFamilyAccountId] = useState<string | null>(null)
  const [devLastExecutedTradeId, setDevLastExecutedTradeId] = useState<string | null>(null)

  const [devTradeSymbol, setDevTradeSymbol] = useState('DEVTEST')
  const [devTradeAssetType, setDevTradeAssetType] = useState('stock')
  const [devTradePlatform, setDevTradePlatform] = useState('DEV')
  const [devTradeExecutionTime, setDevTradeExecutionTime] = useState(() => new Date().toISOString())
  const [devTradeUnits, setDevTradeUnits] = useState('1')
  const [devTradePrice, setDevTradePrice] = useState('100')
  const [devTradeFee, setDevTradeFee] = useState('0')
  const [devTradeScheduleAt, setDevTradeScheduleAt] = useState('')

  const [devAllocFamilyAccountId, setDevAllocFamilyAccountId] = useState('')
  const [devAllocExecutedTradeId, setDevAllocExecutedTradeId] = useState('')
  const [devAllocUnitsAllocated, setDevAllocUnitsAllocated] = useState('1')
  const [showRaw, setShowRaw] = useState(false)
  const [bulkAccountsCsv, setBulkAccountsCsv] = useState('')
  const [bulkTradesCsv, setBulkTradesCsv] = useState('')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkLog, setBulkLog] = useState<string[]>([])

  const investorUidAllowlist = useMemo(() => {
    const raw = (import.meta.env as unknown as { VITE_INVESTOR_UIDS?: unknown }).VITE_INVESTOR_UIDS
    if (typeof raw !== 'string') return []
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  }, [])

  const investorEmailAllowlist = useMemo(() => {
    const raw = (import.meta.env as unknown as { VITE_INVESTOR_EMAILS?: unknown })
      .VITE_INVESTOR_EMAILS
    if (typeof raw !== 'string') return []
    return raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  }, [])

  const isInvestor = useMemo(() => {
    if (investorUidAllowlist.includes('*')) return true

    if (userId) {
      const uidMatch = investorUidAllowlist.some((entry) => {
        if (!entry) return false
        if (entry === userId) return true
        // Convenience: allow prefix matching (e.g. first 8 chars shown in UI).
        if (entry.length >= 8 && userId.startsWith(entry)) return true
        return false
      })
      if (uidMatch) return true
    }

    if (userEmail) {
      const email = userEmail.trim().toLowerCase()
      if (email && investorEmailAllowlist.includes(email)) return true
    }

    return false
  }, [investorEmailAllowlist, investorUidAllowlist, userEmail, userId])

  // Keep destructive debug/test controls hidden unless the signed-in user is the investor.
  const devToolsEnabled = devEnabled && isInvestor

  // Core portfolio operations should be available to any signed-in user.
  const managementToolsEnabled = !!userId

  async function getSessionLogged(context: string) {
    logCallStart({ op: 'auth.getSession', context })
    try {
      const session = await getSession()
      logCallOk({ op: 'auth.getSession', context, user_id: session?.user?.id ?? null })
      return session
    } catch (e) {
      logCallError({ op: 'auth.getSession', context }, e)
      throw e
    }
  }

  async function devCtx() {
    const session = await getSessionLogged('devCtx')
    const uid = session?.user?.id
    if (!uid) throw new Error('Not authenticated. Sign in required.')
    const sb = getSupabaseClient()
    return { sb, uid }
  }

  async function devCreateFamilyAccount() {
    setError(null)
    setDevBusy(true)
    try {
      const { sb, uid } = await devCtx()
      const name = devAccountName.trim() || `[DEV] Test Account ${new Date().toISOString()}`

      const payload = { display_name: name } satisfies InsertFamilyAccountPayloadCanonical

      logCallStart({
        op: 'insert',
        schema: 'finance',
        table: 'family_accounts',
        user_id: uid,
        payload,
      })

      const args = { payload } satisfies InsertFamilyAccountRpcArgsCanonical
      const res = await sb.rpc('insert_family_account', args)
      if (res.error) {
        logCallError(
          { op: 'insert', schema: 'finance', table: 'family_accounts', user_id: uid },
          res.error,
        )
        throw new Error(`[insert_family_account] ${safeMsg(res.error)}`)
      }

      const createdAccountId = (res.data as unknown as { id?: unknown } | null)?.id
      if (typeof createdAccountId === 'string' && createdAccountId) {
        setDevLastFamilyAccountId(createdAccountId)
        setDevAllocFamilyAccountId(createdAccountId)
      }

      logCallOk({
        op: 'insert',
        schema: 'finance',
        table: 'family_accounts',
        user_id: uid,
        rows: rowCount(res.data),
      })
      await loadAll()
    } catch (e) {
      console.error('[investments][dev] create family account failed', e)
      setError(explainInvestmentsError(e))
    } finally {
      setDevBusy(false)
    }
  }

  async function devCreateExecutedTrade() {
    setError(null)
    setDevBusy(true)
    try {
      const { sb, uid } = await devCtx()
      const asset_symbol = devTradeSymbol.trim() || 'DEVTEST'
      const units_acquired = Number(devTradeUnits)
      const price = Number(devTradePrice)
      const fee = Number(devTradeFee)
      const execution_time = devTradeExecutionTime.trim()
      const asset_type = devTradeAssetType.trim().toLowerCase()
      const platform = devTradePlatform.trim()

      if (!Number.isFinite(units_acquired) || units_acquired <= 0)
        throw new Error('Units acquired must be > 0')
      if (!Number.isFinite(price) || price <= 0) throw new Error('Trade price must be > 0')
      if (!Number.isFinite(fee) || fee < 0) throw new Error('Fee must be >= 0')

      if (asset_type && asset_type !== 'stock' && asset_type !== 'crypto') {
        throw new Error('Asset Type must be stock or crypto (or leave blank)')
      }

      const payload = {
        asset_symbol,
        ...(asset_type ? { asset_type } : {}),
        ...(platform ? { platform } : {}),
        ...(execution_time ? { execution_time } : {}),
        price,
        units_acquired,
        fee,
      } satisfies InsertExecutedTradePayloadCanonical

      logCallStart({
        op: 'insert',
        schema: 'finance',
        table: 'executed_trades',
        user_id: uid,
        payload,
      })

      const args = { payload } satisfies InsertExecutedTradeRpcArgsCanonical
      const res = await sb.rpc('insert_executed_trade', args)
      if (res.error) {
        logCallError(
          { op: 'insert', schema: 'finance', table: 'executed_trades', user_id: uid },
          res.error,
        )
        throw new Error(`[insert_executed_trade] ${safeMsg(res.error)}`)
      }

      const createdTradeId = (res.data as unknown as { id?: unknown } | null)?.id
      if (typeof createdTradeId === 'string' && createdTradeId) {
        setDevLastExecutedTradeId(createdTradeId)
        setDevAllocExecutedTradeId(createdTradeId)
      }

      logCallOk({
        op: 'insert',
        schema: 'finance',
        table: 'executed_trades',
        user_id: uid,
        rows: rowCount(res.data),
      })
      await loadAll()
    } catch (e) {
      console.error('[investments][dev] create executed trade failed', e)
      const msg = safeMsg(e)
      if (/executed_trades_asset_type_check/i.test(msg)) {
        setError(
          [
            msg,
            'Tip: your DB has a CHECK constraint on `executed_trades.asset_type`.',
            'Allowed values are: stock, crypto (or leave blank).',
          ].join(' '),
        )
      } else {
        setError(explainInvestmentsError(msg))
      }
    } finally {
      setDevBusy(false)
    }
  }

  async function devCreateAllocation() {
    if (!devToolsEnabled) return
    setError(null)
    setDevBusy(true)
    try {
      const { sb, uid } = await devCtx()
      const family_account_id = devAllocFamilyAccountId.trim() || devLastFamilyAccountId || ''
      const executed_trade_id = devAllocExecutedTradeId.trim() || devLastExecutedTradeId || ''
      const units_allocated = Number(devAllocUnitsAllocated)

      if (!family_account_id) throw new Error('Family Account ID is required')
      if (!executed_trade_id) throw new Error('Executed Trade ID is required')
      if (!Number.isFinite(units_allocated) || units_allocated <= 0)
        throw new Error('Units allocated must be > 0')

      const payload = {
        family_account_id,
        executed_trade_id,
        units_allocated,
      } satisfies InsertAllocationPayloadCanonical
      logCallStart({
        op: 'insert',
        schema: 'finance',
        table: 'allocations',
        user_id: uid,
        payload,
      })

      const args = { payload } satisfies InsertAllocationRpcArgsCanonical
      const res = await sb.rpc('insert_allocation', args)
      if (res.error) {
        logCallError(
          { op: 'insert', schema: 'finance', table: 'allocations', user_id: uid },
          res.error,
        )
        throw new Error(`[insert_allocation] ${safeMsg(res.error)}`)
      }

      logCallOk({
        op: 'insert',
        schema: 'finance',
        table: 'allocations',
        user_id: uid,
        rows: rowCount(res.data),
      })
      await loadAll()
    } catch (e) {
      console.error('[investments][dev] create allocation failed', e)
      setError(safeMsg(e))
    } finally {
      setDevBusy(false)
    }
  }

  async function devCreateTradeEvenSplit() {
    setError(null)
    setDevBusy(true)
    try {
      const { sb, uid } = await devCtx()
      const asset_symbol = devTradeSymbol.trim() || 'DEVTEST'
      const units_acquired = Number(devTradeUnits)
      const price = Number(devTradePrice)
      const fee = Number(devTradeFee)
      const execution_time = devTradeExecutionTime.trim()
      const asset_type = devTradeAssetType.trim().toLowerCase()
      const platform = devTradePlatform.trim()
      const schedule_at = devTradeScheduleAt.trim()

      if (!Number.isFinite(units_acquired) || units_acquired <= 0)
        throw new Error('Units acquired must be > 0')
      if (!Number.isFinite(price) || price <= 0) throw new Error('Trade price must be > 0')
      if (!Number.isFinite(fee) || fee < 0) throw new Error('Fee must be >= 0')

      if (asset_type && asset_type !== 'stock' && asset_type !== 'crypto') {
        throw new Error('Asset Type must be stock or crypto (or leave blank)')
      }

      const payload = {
        asset_symbol,
        ...(asset_type ? { asset_type } : {}),
        ...(platform ? { platform } : {}),
        ...(execution_time ? { execution_time } : {}),
        ...(schedule_at ? { execution_time: schedule_at } : {}),
        price,
        units_acquired,
        fee,
      } satisfies InsertTradeEvenSplitPayloadCanonical

      logCallStart({
        op: 'rpc',
        schema: 'public',
        fn: 'insert_trade_even_split',
        user_id: uid,
        payload,
      })

      const args = { payload } satisfies InsertTradeEvenSplitRpcArgsCanonical
      const res = await sb.rpc('insert_trade_even_split', args)
      if (res.error) {
        logCallError(
          { op: 'rpc', schema: 'public', fn: 'insert_trade_even_split', user_id: uid },
          res.error,
        )
        throw new Error(`[insert_trade_even_split] ${safeMsg(res.error)}`)
      }

      logCallOk({
        op: 'rpc',
        schema: 'public',
        fn: 'insert_trade_even_split',
        user_id: uid,
        rows: rowCount(res.data),
      })
      await loadAll()
    } catch (e) {
      console.error('[investments][dev] create even-split trade failed', e)
      const msg = safeMsg(e)
      if (/No family accounts found for this user/i.test(msg)) {
        setError('Create at least one family account before using Even Split Trade.')
      } else {
        setError(explainInvestmentsError(msg))
      }
    } finally {
      setDevBusy(false)
    }
  }

  async function bulkImportAccounts() {
    setError(null)
    setBulkBusy(true)
    try {
      const { sb } = await devCtx()
      const names = parseAccountsCsv(bulkAccountsCsv)
      if (names.length === 0) throw new Error('No account names found in CSV input.')

      const logs: string[] = []
      let success = 0
      let failed = 0
      for (let i = 0; i < names.length; i += 1) {
        const display_name = names[i]
        const payload = { display_name } satisfies InsertFamilyAccountPayloadCanonical
        const args = { payload } satisfies InsertFamilyAccountRpcArgsCanonical
        const res = await sb.rpc('insert_family_account', args)
        if (res.error) {
          failed += 1
          logs.push(`Account ${i + 1} failed (${display_name}): ${safeMsg(res.error)}`)
          continue
        }
        success += 1
      }

      setBulkLog([`Accounts import done. success=${success} failed=${failed}`, ...logs])
      await loadAll()
    } catch (e) {
      setError(explainInvestmentsError(e))
    } finally {
      setBulkBusy(false)
    }
  }

  async function bulkImportTrades() {
    setError(null)
    setBulkBusy(true)
    try {
      const { sb } = await devCtx()
      const rows = parseTradesCsv(bulkTradesCsv)
      if (rows.length === 0) throw new Error('No valid trade rows found in CSV input.')

      const logs: string[] = []
      let success = 0
      let failed = 0
      let scheduled = 0

      for (let i = 0; i < rows.length; i += 1) {
        const r = rows[i]
        try {
          if (r.scheduleAt) {
            const payload = {
              asset_symbol: r.symbol,
              ...(r.assetType ? { asset_type: r.assetType } : {}),
              ...(r.platform ? { platform: r.platform } : {}),
              ...(r.executionTime ? { execution_time: r.executionTime } : {}),
              price: r.price,
              units_acquired: r.unitsAcquired,
              fee: r.fee,
              schedule_at: r.scheduleAt,
            } satisfies ScheduleTradeEvenSplitPayloadCanonical
            const args = { payload } satisfies ScheduleTradeEvenSplitRpcArgsCanonical
            const res = await sb.rpc('schedule_trade_even_split', args)
            if (res.error) throw res.error
            scheduled += 1
            success += 1
            continue
          }

          if (r.useEvenSplit) {
            const payload = {
              asset_symbol: r.symbol,
              ...(r.assetType ? { asset_type: r.assetType } : {}),
              ...(r.platform ? { platform: r.platform } : {}),
              ...(r.executionTime ? { execution_time: r.executionTime } : {}),
              price: r.price,
              units_acquired: r.unitsAcquired,
              fee: r.fee,
            } satisfies InsertTradeEvenSplitPayloadCanonical
            const args = { payload } satisfies InsertTradeEvenSplitRpcArgsCanonical
            const res = await sb.rpc('insert_trade_even_split', args)
            if (res.error) throw res.error
          } else {
            const payload = {
              asset_symbol: r.symbol,
              ...(r.assetType ? { asset_type: r.assetType } : {}),
              ...(r.platform ? { platform: r.platform } : {}),
              ...(r.executionTime ? { execution_time: r.executionTime } : {}),
              price: r.price,
              units_acquired: r.unitsAcquired,
              fee: r.fee,
            } satisfies InsertExecutedTradePayloadCanonical
            const args = { payload } satisfies InsertExecutedTradeRpcArgsCanonical
            const res = await sb.rpc('insert_executed_trade', args)
            if (res.error) throw res.error
          }

          success += 1
        } catch (rowErr) {
          failed += 1
          logs.push(`Trade ${i + 1} failed (${r.symbol}): ${safeMsg(rowErr)}`)
        }
      }

      setBulkLog([
        `Trades import done. success=${success} failed=${failed} scheduled=${scheduled}`,
        ...logs,
      ])
      await loadAll()
    } catch (e) {
      setError(explainInvestmentsError(e))
    } finally {
      setBulkBusy(false)
    }
  }

  async function devDeleteFamilyAccount(account_id: string) {
    if (!devToolsEnabled) return
    if (!account_id) return
    if (!confirm('Delete this family account? This cannot be undone.')) return

    setError(null)
    setDevBusy(true)
    try {
      const { sb, uid } = await devCtx()
      logCallStart({ op: 'delete', schema: 'finance', table: 'family_accounts', user_id: uid, account_id })
      const res = await sb.rpc('delete_family_account', { uid, account_id })
      if (res.error) {
        logCallError({ op: 'delete', schema: 'finance', table: 'family_accounts', user_id: uid }, res.error)
        throw new Error(`[delete_family_account] ${safeMsg(res.error)}`)
      }
      logCallOk({ op: 'delete', schema: 'finance', table: 'family_accounts', user_id: uid })
      await loadAll()
    } catch (e) {
      console.error('[investments][dev] delete family account failed', e)
      setError(safeMsg(e))
    } finally {
      setDevBusy(false)
    }
  }

  async function devDeleteExecutedTrade(trade_id: string) {
    if (!devToolsEnabled) return
    if (!trade_id) return
    if (!confirm('Delete this executed trade? This cannot be undone.')) return

    setError(null)
    setDevBusy(true)
    try {
      const { sb, uid } = await devCtx()
      logCallStart({ op: 'delete', schema: 'finance', table: 'executed_trades', user_id: uid, trade_id })
      const res = await sb.rpc('delete_executed_trade', { uid, trade_id })
      if (res.error) {
        logCallError({ op: 'delete', schema: 'finance', table: 'executed_trades', user_id: uid }, res.error)
        throw new Error(`[delete_executed_trade] ${safeMsg(res.error)}`)
      }
      logCallOk({ op: 'delete', schema: 'finance', table: 'executed_trades', user_id: uid })
      await loadAll()
    } catch (e) {
      console.error('[investments][dev] delete executed trade failed', e)
      setError(safeMsg(e))
    } finally {
      setDevBusy(false)
    }
  }

  async function devDeleteAllocation(allocation_id: string) {
    if (!devToolsEnabled) return
    if (!allocation_id) return
    if (!confirm('Delete this allocation? This cannot be undone.')) return

    setError(null)
    setDevBusy(true)
    try {
      const { sb, uid } = await devCtx()
      logCallStart({ op: 'delete', schema: 'finance', table: 'allocations', user_id: uid, allocation_id })
      const res = await sb.rpc('delete_allocation', { uid, allocation_id })
      if (res.error) {
        logCallError({ op: 'delete', schema: 'finance', table: 'allocations', user_id: uid }, res.error)
        throw new Error(`[delete_allocation] ${safeMsg(res.error)}`)
      }
      logCallOk({ op: 'delete', schema: 'finance', table: 'allocations', user_id: uid })
      await loadAll()
    } catch (e) {
      console.error('[investments][dev] delete allocation failed', e)
      setError(safeMsg(e))
    } finally {
      setDevBusy(false)
    }
  }

  async function devDeleteTestRows() {
    if (!devToolsEnabled) return
    setError(null)
    setDevBusy(true)
    try {
      const { sb, uid } = await devCtx()

      logCallStart({
        op: 'delete',
        schema: 'finance',
        table: 'family_accounts',
        user_id: uid,
        filter: "user_id=... AND display_name ILIKE '[DEV]%",
      })
      logCallStart({
        op: 'delete',
        schema: 'finance',
        table: 'executed_trades',
        user_id: uid,
        filter: "user_id=... AND asset_symbol ILIKE 'DEV%'",
      })
      logCallStart({
        op: 'delete',
        schema: 'finance',
        table: 'allocations',
        user_id: uid,
        filter: 'user_id=... AND (family_account_id in DEV accounts OR executed_trade_id in DEV trades)',
      })

      const accountIds = accounts
        .filter((a) =>
          String(((a as unknown as Record<string, unknown>).display_name ?? a.account_name) ?? '').startsWith(
            '[DEV]',
          ),
        )
        .map((a) => a.id)
      const tradeIds = trades
        .filter((t) =>
          String(((t as unknown as Record<string, unknown>).asset_symbol ?? t.symbol) ?? '').startsWith(
            'DEV',
          ),
        )
        .map((t) => t.id)
      const allocationIds = allocs
        .filter((a) => {
          const aAny = a as unknown as Record<string, unknown>
          const fa = String(aAny.family_account_id ?? '')
          const tr = String(aAny.executed_trade_id ?? '')
          const legacy = String(aAny.allocation_type ?? '')
          return (
            (fa && accountIds.includes(fa)) ||
            (tr && tradeIds.includes(tr)) ||
            (legacy && legacy.startsWith('[DEV]'))
          )
        })
        .map((a) => a.id)

      const [accDel, tradeDel, allocDel] = await Promise.all([
        Promise.all(
          accountIds.map((account_id) => sb.rpc('delete_family_account', { uid, account_id })),
        ),
        Promise.all(tradeIds.map((trade_id) => sb.rpc('delete_executed_trade', { uid, trade_id }))),
        Promise.all(
          allocationIds.map((allocation_id) => sb.rpc('delete_allocation', { uid, allocation_id })),
        ),
      ])

      const accErr = accDel.find((r) => r.error)
      const tradeErr = tradeDel.find((r) => r.error)
      const allocErr = allocDel.find((r) => r.error)

      if (accErr?.error) {
        logCallError(
          { op: 'delete', schema: 'finance', table: 'family_accounts', user_id: uid },
          accErr.error,
        )
        throw accErr.error
      }
      if (tradeErr?.error) {
        logCallError(
          { op: 'delete', schema: 'finance', table: 'executed_trades', user_id: uid },
          tradeErr.error,
        )
        throw tradeErr.error
      }
      if (allocErr?.error) {
        logCallError(
          { op: 'delete', schema: 'finance', table: 'allocations', user_id: uid },
          allocErr.error,
        )
        throw allocErr.error
      }

      logCallOk({ op: 'delete', schema: 'finance', table: 'family_accounts', user_id: uid })
      logCallOk({ op: 'delete', schema: 'finance', table: 'executed_trades', user_id: uid })
      logCallOk({ op: 'delete', schema: 'finance', table: 'allocations', user_id: uid })

      await loadAll()
    } catch (e) {
      console.error('[investments][dev] delete test rows failed', e)
      const msg = safeMsg(e)
      if (/permission denied for table family_accounts/i.test(msg)) {
        setError(
          [
            'Delete blocked by DB privileges.',
            'Grant `DELETE` on `finance.*` tables to `authenticated`, or run deletes via SECURITY DEFINER RPCs.',
            `Raw: ${msg}`,
          ].join(' '),
        )
      } else {
        setError(msg)
      }
    } finally {
      setDevBusy(false)
    }
  }

  useEffect(() => {
    let alive = true
    void getSessionLogged('mount')
      .then((s) => {
        if (!alive) return
        setUserId(s?.user?.id ?? null)
        setUserEmail(s?.user?.email ?? null)
      })
      .catch((e) => {
        if (!alive) return
        console.error('[investments] getSession failed', e)
        setError(safeMsg(e))
      })

    const { data } = onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null)
      setUserEmail(session?.user?.email ?? null)
    })

    return () => {
      alive = false
      data.subscription.unsubscribe()
    }
  }, [])

  async function loadAll() {
    setError(null)
    if (!userId) return

    setLoadingAccounts(true)
    setLoadingTrades(true)
    setLoadingAllocs(true)

    try {
      const session = await getSessionLogged('loadAll')
      const uid = session?.user?.id
      if (!uid) throw new Error('Not authenticated. Sign in required.')

      const sb = getSupabaseClient()

      logCallStart({ op: 'select', schema: 'finance', table: 'family_accounts', user_id: uid })
      logCallStart({ op: 'select', schema: 'finance', table: 'executed_trades', user_id: uid })
      logCallStart({ op: 'select', schema: 'finance', table: 'allocations', user_id: uid })

      const [accountsRes, tradesRes, allocsRes] = await Promise.all([
        sb.rpc('get_family_accounts', { uid }),
        sb.rpc('get_executed_trades', { uid }),
        sb.rpc('get_allocations', { uid }),
      ])

      const errors: string[] = []

      if (accountsRes.error) {
        logCallError(
          { op: 'select', schema: 'finance', table: 'family_accounts', user_id: uid },
          accountsRes.error,
        )
        errors.push(`[get_family_accounts] ${safeMsg(accountsRes.error)}`)
        setAccounts([])
      } else {
        logCallOk({
          op: 'select',
          schema: 'finance',
          table: 'family_accounts',
          user_id: uid,
          rows: rowCount((accountsRes as PostgrestResult<unknown>).data),
        })
        setAccounts((accountsRes.data ?? []) as unknown as FamilyAccountRow[])
      }

      if (tradesRes.error) {
        logCallError(
          { op: 'select', schema: 'finance', table: 'executed_trades', user_id: uid },
          tradesRes.error,
        )
        errors.push(`[get_executed_trades] ${safeMsg(tradesRes.error)}`)
        setTrades([])
      } else {
        logCallOk({
          op: 'select',
          schema: 'finance',
          table: 'executed_trades',
          user_id: uid,
          rows: rowCount((tradesRes as PostgrestResult<unknown>).data),
        })
        setTrades((tradesRes.data ?? []) as unknown as ExecutedTradeRow[])
      }

      if (allocsRes.error) {
        logCallError(
          { op: 'select', schema: 'finance', table: 'allocations', user_id: uid },
          allocsRes.error,
        )
        errors.push(`[get_allocations] ${safeMsg(allocsRes.error)}`)
        setAllocs([])
      } else {
        logCallOk({
          op: 'select',
          schema: 'finance',
          table: 'allocations',
          user_id: uid,
          rows: rowCount((allocsRes as PostgrestResult<unknown>).data),
        })
        setAllocs((allocsRes.data ?? []) as unknown as AllocationRow[])
      }

      if (errors.length > 0) {
        setError(explainInvestmentsError(errors.join(' • ')))
      }
    } catch (e) {
      console.error('[investments] loadAll failed', e)
      setError(explainInvestmentsError(e))
    } finally {
      setLoadingAccounts(false)
      setLoadingTrades(false)
      setLoadingAllocs(false)
    }
  }

  useEffect(() => {
    void loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  const totals = useMemo(() => {
    let total = 0
    let known = 0
    for (const a of accounts) {
      const b = coerceBalance(a.balances).value
      if (typeof b === 'number') {
        total += b
        known += 1
      }
    }
    return { total, known, count: accounts.length }
  }, [accounts])

  const allocationTotal = useMemo(() => {
    let sum = 0
    for (const a of allocs) {
      const v = pickNumber(a, ['units_allocated', 'target_percent'])
      if (typeof v === 'number' && Number.isFinite(v)) sum += v
    }
    return sum
  }, [allocs])

  return (
    <section className="grid" style={{ gap: '1rem' }}>
      <header className="card" style={{ display: 'grid', gap: 8 }}>
        <h2 className="section-title" style={{ margin: 0 }}>
          Investments
        </h2>
        <p className="muted" style={{ margin: 0 }}>
          Data is scoped to the signed-in user via Supabase Auth + RLS (`auth.uid()` / `user_id`).
        </p>
        {!userId ? (
          <p className="muted" style={{ margin: 0 }}>
            Sign in to view your accounts, trades, and allocations.
          </p>
        ) : (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              className="btn"
              onClick={() => loadAll()}
              disabled={loadingAccounts || loadingTrades || loadingAllocs}
            >
              {loadingAccounts || loadingTrades || loadingAllocs ? 'Loading…' : 'Refresh'}
            </button>
            <span className="muted" style={{ fontSize: 12 }}>
              {devToolsEnabled ? `User: ${userId.slice(0, 8)}…` : 'Signed in'}
            </span>
            {error && (
              <span className="muted" style={{ color: 'var(--accent-2)' }}>
                {error}
              </span>
            )}
          </div>
        )}
      </header>

      {devToolsEnabled && userId && (
        <article
          className="card"
          style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}
        >
          <strong style={{ fontSize: 13 }}>Debug</strong>
          <span className="muted" style={{ fontSize: 12 }}>
            user_id: {userId}
          </span>
          <span className="muted" style={{ fontSize: 12 }}>
            family_accounts: {accounts.length}
          </span>
          <span className="muted" style={{ fontSize: 12 }}>
            executed_trades: {trades.length}
          </span>
          <span className="muted" style={{ fontSize: 12 }}>
            allocations: {allocs.length}
          </span>
        </article>
      )}

      {devToolsEnabled && <InvestmentsJwtDebugStrip enabled={devToolsEnabled} />}

      <article className="card" style={{ overflowX: 'auto' }}>
        <h3 className="section-title" style={{ marginTop: 0 }}>
          Family Accounts
        </h3>
        {loadingAccounts ? (
          <p className="muted">Loading accounts…</p>
        ) : (
          <>
            <p className="muted" style={{ marginTop: 0 }}>
              {totals.known > 0
                ? `Total (known balances): ${fmtMoney(totals.total)} • Accounts: ${totals.count}`
                : `Accounts: ${totals.count}`}
            </p>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr className="muted" style={{ textAlign: 'left' }}>
                  <th style={{ padding: '8px 6px' }}>Account</th>
                  <th style={{ padding: '8px 6px' }}>Balance</th>
                  <th style={{ padding: '8px 6px' }}>Updated</th>
                  {devToolsEnabled && <th style={{ padding: '8px 6px' }}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => {
                  const bal = coerceBalance(a.balances)
                  const name =
                    pickString(a, ['display_name', 'account_name']) ||
                    (typeof a.id === 'string' ? a.id.slice(0, 8) + '…' : '—')
                  const updated = pickString(a, ['updated_at', 'created_at'])
                  return (
                    <tr key={a.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 6px' }}>{name}</td>
                      <td style={{ padding: '8px 6px' }}>{bal.label}</td>
                      <td style={{ padding: '8px 6px' }}>{updated ? fmtDate(updated) : '—'}</td>
                      {devToolsEnabled && (
                        <td style={{ padding: '8px 6px' }}>
                          <button
                            className="btn"
                            onClick={() => void devDeleteFamilyAccount(a.id)}
                            disabled={devBusy}
                          >
                            Delete
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })}
                {accounts.length === 0 && (
                  <tr>
                    <td
                      className="muted"
                      style={{ padding: '10px 6px' }}
                      colSpan={devToolsEnabled ? 4 : 3}
                    >
                      No accounts found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        )}
      </article>

      <article className="card" style={{ overflowX: 'auto' }}>
        <h3 className="section-title" style={{ marginTop: 0 }}>
          Executed Trades
        </h3>
        {loadingTrades ? (
          <p className="muted">Loading trades…</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr className="muted" style={{ textAlign: 'left' }}>
                <th style={{ padding: '8px 6px' }}>When</th>
                <th style={{ padding: '8px 6px' }}>Symbol</th>
                <th style={{ padding: '8px 6px' }}>Type</th>
                <th style={{ padding: '8px 6px' }}>Qty</th>
                <th style={{ padding: '8px 6px' }}>Price</th>
                <th style={{ padding: '8px 6px' }}>Notional</th>
                {devToolsEnabled && <th style={{ padding: '8px 6px' }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => {
                const when = pickString(t, ['execution_time', 'executed_at', 'created_at'])
                const symbol = pickString(t, ['asset_symbol', 'symbol'])
                const kind = pickString(t, ['asset_type', 'type', 'platform'])
                const qty = pickNumber(t, ['units_acquired', 'quantity'])
                const price = pickNumber(t, ['price'])
                const dollarAmount = pickNumber(t, ['dollar_amount'])
                const fee = pickNumber(t, ['fee']) ?? 0
                const notional =
                  dollarAmount ??
                  ((typeof qty === 'number' ? qty : 0) * (typeof price === 'number' ? price : 0) +
                    (typeof fee === 'number' ? fee : 0))
                return (
                  <tr key={t.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 6px', whiteSpace: 'nowrap' }}>
                      {when ? fmtDate(when) : '—'}
                    </td>
                    <td style={{ padding: '8px 6px' }}>{symbol || '—'}</td>
                    <td style={{ padding: '8px 6px' }}>{kind || '—'}</td>
                    <td style={{ padding: '8px 6px' }}>{typeof qty === 'number' ? qty : '—'}</td>
                    <td style={{ padding: '8px 6px' }}>
                      {typeof price === 'number' ? fmtMoney(price) : '—'}
                    </td>
                    <td style={{ padding: '8px 6px' }}>
                      {fmtMoney(Number.isFinite(notional) ? notional : 0)}
                    </td>
                    {devToolsEnabled && (
                      <td style={{ padding: '8px 6px' }}>
                        <button
                          className="btn"
                          onClick={() => void devDeleteExecutedTrade(t.id)}
                          disabled={devBusy}
                        >
                          Delete
                        </button>
                      </td>
                    )}
                  </tr>
                )
              })}
              {trades.length === 0 && (
                <tr>
                  <td
                    className="muted"
                    style={{ padding: '10px 6px' }}
                    colSpan={devToolsEnabled ? 7 : 6}
                  >
                    No trades found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </article>

      <article className="card" style={{ overflowX: 'auto' }}>
        <h3 className="section-title" style={{ marginTop: 0 }}>
          Allocations
        </h3>
        {loadingAllocs ? (
          <p className="muted">Loading allocations…</p>
        ) : (
          <>
            <p className="muted" style={{ marginTop: 0 }}>
              Total allocated: {Number.isFinite(allocationTotal) ? allocationTotal.toFixed(4) : '—'}
            </p>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr className="muted" style={{ textAlign: 'left' }}>
                  <th style={{ padding: '8px 6px' }}>Account</th>
                  <th style={{ padding: '8px 6px' }}>Trade</th>
                  <th style={{ padding: '8px 6px' }}>Units</th>
                  {devToolsEnabled && <th style={{ padding: '8px 6px' }}>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {allocs.map((a) => {
                  const accountId = pickString(a, ['family_account_id'])
                  const tradeId = pickString(a, ['executed_trade_id'])
                  const units = pickNumber(a, ['units_allocated', 'target_percent'])
                  return (
                    <tr key={a.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 6px' }}>{accountId ? accountId.slice(0, 8) + '…' : '—'}</td>
                      <td style={{ padding: '8px 6px' }}>{tradeId ? tradeId.slice(0, 8) + '…' : '—'}</td>
                      <td style={{ padding: '8px 6px' }}>{typeof units === 'number' ? units : '—'}</td>
                      {devToolsEnabled && (
                        <td style={{ padding: '8px 6px' }}>
                          <button
                            className="btn"
                            onClick={() => void devDeleteAllocation(a.id)}
                            disabled={devBusy}
                          >
                            Delete
                          </button>
                        </td>
                      )}
                    </tr>
                  )
                })}
                {allocs.length === 0 && (
                  <tr>
                    <td
                      className="muted"
                      style={{ padding: '10px 6px' }}
                      colSpan={devToolsEnabled ? 4 : 3}
                    >
                      No allocations found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </>
        )}
      </article>

      {managementToolsEnabled && userId && (
        <article className="card" style={{ display: 'grid', gap: 12 }}>
          <h3 className="section-title" style={{ marginTop: 0 }}>
            Portfolio management
          </h3>
          <p className="muted" style={{ margin: 0 }}>
            Uses <code>supabase.rpc(...)</code> and scopes to your <code>user_id</code>. Intended for
            your signed-in account.
          </p>
          <p className="muted" style={{ margin: 0 }}>
            Recommended order: <strong>1)</strong> Create family account → <strong>2)</strong> Create
            executed trade → <strong>3)</strong> Create allocation. The allocation IDs auto-fill from
            the last created rows.
          </p>

          <div style={{ display: 'grid', gap: 10 }}>
            <div style={{ display: 'grid', gap: 8 }}>
              <strong>Create family account</strong>
              <span className="muted" style={{ fontSize: 12 }}>
                Creates a <code>finance.family_accounts</code> row (uses <code>display_name</code>).
              </span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input
                  value={devAccountName}
                  onChange={(e) => setDevAccountName(e.target.value)}
                  placeholder="[DEV] Test Account"
                  style={{ minWidth: 220 }}
                  disabled={devBusy}
                />
                <button
                  className="btn"
                  onClick={() => void devCreateFamilyAccount()}
                  disabled={devBusy}
                >
                  {devBusy ? 'Working…' : 'Create'}
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 8 }}>
              <strong>Create executed trade</strong>
              <span className="muted" style={{ fontSize: 12 }}>
                Creates a <code>finance.executed_trades</code> row. “Units” = <code>units_acquired</code>.
              </span>
              <span className="muted" style={{ fontSize: 12 }}>
                Even Split Trade inserts the trade and auto-allocates units equally across all family accounts.
              </span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input
                  value={devTradeSymbol}
                  onChange={(e) => setDevTradeSymbol(e.target.value)}
                  placeholder="Symbol (asset_symbol)"
                  style={{ width: 140 }}
                  disabled={devBusy}
                />
                <select
                  value={devTradeAssetType}
                  onChange={(e) => setDevTradeAssetType(e.target.value)}
                  style={{ width: 160 }}
                  disabled={devBusy}
                  aria-label="Asset type"
                >
                  <option value="">Asset Type (optional)</option>
                  <option value="stock">stock</option>
                  <option value="crypto">crypto</option>
                </select>
                <input
                  value={devTradePlatform}
                  onChange={(e) => setDevTradePlatform(e.target.value)}
                  placeholder="Platform"
                  style={{ width: 110 }}
                  disabled={devBusy}
                />
                <input
                  value={devTradeExecutionTime}
                  onChange={(e) => setDevTradeExecutionTime(e.target.value)}
                  placeholder="When (ISO, optional)"
                  style={{ minWidth: 240 }}
                  disabled={devBusy}
                />
                <input
                  value={devTradeScheduleAt}
                  onChange={(e) => setDevTradeScheduleAt(e.target.value)}
                  placeholder="Schedule at (ISO, optional)"
                  style={{ minWidth: 240 }}
                  disabled={devBusy}
                />
                <input
                  value={devTradeUnits}
                  onChange={(e) => setDevTradeUnits(e.target.value)}
                  placeholder="Units"
                  style={{ width: 90 }}
                  disabled={devBusy}
                />
                <input
                  value={devTradePrice}
                  onChange={(e) => setDevTradePrice(e.target.value)}
                  placeholder="Price"
                  style={{ width: 90 }}
                  disabled={devBusy}
                />
                <input
                  value={devTradeFee}
                  onChange={(e) => setDevTradeFee(e.target.value)}
                  placeholder="Fee"
                  style={{ width: 90 }}
                  disabled={devBusy}
                />
                <button
                  className="btn"
                  onClick={() => void devCreateExecutedTrade()}
                  disabled={devBusy}
                >
                  {devBusy ? 'Working…' : 'Create Trade Only'}
                </button>
                <button
                  className="btn"
                  onClick={() => void devCreateTradeEvenSplit()}
                  disabled={devBusy}
                >
                  {devBusy ? 'Working…' : 'Create + Even Split'}
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 8 }}>
              <strong>Bulk import family accounts (CSV)</strong>
              <span className="muted" style={{ fontSize: 12 }}>
                Paste one account per line or CSV with header: <code>display_name</code>.
              </span>
              <textarea
                value={bulkAccountsCsv}
                onChange={(e) => setBulkAccountsCsv(e.target.value)}
                placeholder={[
                  'display_name',
                  'Grandma Fund',
                  'Uncle Mike Fund',
                  'Cousin Ana Fund',
                ].join('\n')}
                rows={6}
                style={{ width: '100%', padding: 10, borderRadius: 10 }}
                disabled={bulkBusy}
              />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn" onClick={() => void bulkImportAccounts()} disabled={bulkBusy}>
                  {bulkBusy ? 'Importing…' : 'Import Accounts CSV'}
                </button>
              </div>
            </div>

            <div style={{ display: 'grid', gap: 8 }}>
              <strong>Bulk import trades (CSV)</strong>
              <span className="muted" style={{ fontSize: 12 }}>
                Header format: <code>asset_symbol,units_acquired,price,fee,execution_time,asset_type,platform,even_split,schedule_at</code>
              </span>
              <span className="muted" style={{ fontSize: 12 }}>
                <code>even_split</code>: true/false. If true, trade auto-allocates evenly across all family accounts.
              </span>
              <textarea
                value={bulkTradesCsv}
                onChange={(e) => setBulkTradesCsv(e.target.value)}
                placeholder={[
                  'asset_symbol,units_acquired,price,fee,execution_time,asset_type,platform,even_split,schedule_at',
                  'AAPL,1.5,195.23,0,2026-05-21T14:30:00Z,stock,Robinhood,true,',
                  'BTC,0.01,68500,2,2026-06-10T12:00:00Z,crypto,Coinbase,true,2026-06-12T12:00:00Z',
                ].join('\n')}
                rows={10}
                style={{ width: '100%', padding: 10, borderRadius: 10 }}
                disabled={bulkBusy}
              />
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn" onClick={() => void bulkImportTrades()} disabled={bulkBusy}>
                  {bulkBusy ? 'Importing…' : 'Import Trades CSV'}
                </button>
              </div>
              {bulkLog.length > 0 && (
                <pre
                  style={{
                    margin: 0,
                    padding: 12,
                    border: '1px solid var(--border)',
                    borderRadius: 12,
                    overflowX: 'auto',
                    maxHeight: 240,
                  }}
                >
                  {bulkLog.join('\n')}
                </pre>
              )}
            </div>

            <div style={{ display: 'grid', gap: 8 }}>
              <strong>Create allocation</strong>
              <span className="muted" style={{ fontSize: 12 }}>
                Links an account + trade by inserting <code>finance.allocations</code>.
              </span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <select
                  value={devAllocFamilyAccountId}
                  onChange={(e) => setDevAllocFamilyAccountId(e.target.value)}
                  disabled={devBusy || accounts.length === 0}
                  style={{ minWidth: 280 }}
                >
                  <option value="">
                    {accounts.length === 0
                      ? 'No accounts loaded'
                      : 'Pick account (family_account_id)'}
                  </option>
                  {accounts.map((a) => {
                    const label = pickString(a, ['display_name', 'account_name']) || a.id
                    return (
                      <option key={a.id} value={a.id}>
                        {label}
                      </option>
                    )
                  })}
                </select>
                <select
                  value={devAllocExecutedTradeId}
                  onChange={(e) => setDevAllocExecutedTradeId(e.target.value)}
                  disabled={devBusy || trades.length === 0}
                  style={{ minWidth: 280 }}
                >
                  <option value="">
                    {trades.length === 0 ? 'No trades loaded' : 'Pick trade (executed_trade_id)'}
                  </option>
                  {trades.map((t) => {
                    const symbol = pickString(t, ['asset_symbol', 'symbol']) || '—'
                    const when = pickString(t, ['execution_time', 'executed_at', 'created_at'])
                    const label = when ? `${symbol} (${fmtDate(when)})` : symbol
                    return (
                      <option key={t.id} value={t.id}>
                        {label}
                      </option>
                    )
                  })}
                </select>
                <input
                  value={devAllocUnitsAllocated}
                  onChange={(e) => setDevAllocUnitsAllocated(e.target.value)}
                  placeholder="Units allocated"
                  style={{ width: 140 }}
                  disabled={devBusy}
                />
                <button
                  className="btn"
                  onClick={() => void devCreateAllocation()}
                  disabled={devBusy}
                >
                  {devBusy ? 'Working…' : 'Create'}
                </button>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <button className="btn" onClick={() => void loadAll()} disabled={devBusy}>
                Refresh lists
              </button>
              {devToolsEnabled && (
                <button className="btn" onClick={() => setShowRaw((v) => !v)} disabled={devBusy}>
                  {showRaw ? 'Hide raw rows' : 'Show raw rows'}
                </button>
              )}
              {devToolsEnabled && (
                <button
                  className="btn"
                  onClick={() => void devDeleteTestRows()}
                  disabled={devBusy}
                  aria-label="Delete DEV test rows"
                >
                  {devBusy ? 'Working…' : 'Delete DEV test rows'}
                </button>
              )}
            </div>

            {devToolsEnabled && showRaw && (
              <pre
                style={{
                  margin: 0,
                  padding: 12,
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                  overflowX: 'auto',
                  maxHeight: 340,
                }}
              >
                {JSON.stringify(
                  {
                    accounts,
                    trades,
                    allocations: allocs,
                  },
                  null,
                  2,
                )}
              </pre>
            )}
          </div>
        </article>
      )}
    </section>
  )
}
