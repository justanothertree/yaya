import { useEffect, useId, useMemo, useState } from 'react'
import { previewMember } from '../dev/previewMember'
import { getSupabaseClient } from '../finance/client'
import {
  KINDS,
  makeAlerts,
  realBrowser,
  type AlertsApi,
  type Kind,
  type Prefs,
} from './phoneAlerts'
import { VAPID_PUBLIC_KEY } from './vapid'

/**
 * The alerts this card talks to: the real ones, or — under the previewMember harness — the
 * stand-in in src/dev/alertsPreview.ts, which the pane can draw without a key or a session.
 *
 * ⚠️ `import.meta.env.DEV` IS WRITTEN OUT AT BOTH SITES rather than trusted to arrive through
 * `previewMember`. Vite replaces it with a literal `false` in a production build, so the dynamic
 * import sits in dead code and the stand-in module is never emitted at all — a property of the
 * branch, which is the only thing CLAUDE.md says that folding can be trusted with.
 */
function useAlertsApi(): AlertsApi | null {
  const [standIn, setStandIn] = useState<AlertsApi | null>(null)
  useEffect(() => {
    if (!(import.meta.env.DEV && previewMember)) return
    let live = true
    void import('../dev/alertsPreview').then((m) => {
      if (live) setStandIn(m.alertsStandIn())
    })
    return () => {
      live = false
    }
  }, [])
  const real = useMemo(
    () =>
      makeAlerts(
        VAPID_PUBLIC_KEY,
        async (fn, args) => await getSupabaseClient().rpc(fn, args),
        realBrowser,
      ),
    [],
  )
  return import.meta.env.DEV && previewMember ? standIn : real
}

/** a row that is a switch: the label, and the site's switch drawn at its end */
function Switch({
  label,
  on,
  disabled,
  onFlip,
}: {
  label: string
  on: boolean
  disabled?: boolean
  onFlip: () => void
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className="alerts-switch"
      disabled={disabled}
      onClick={onFlip}
    >
      <span>{label}</span>
      <span className={'nav-menu-switch' + (on ? ' is-on' : '')} aria-hidden />
    </button>
  )
}

const line = { margin: 0, fontSize: '0.82rem' } as const

/**
 * 📱 Phone alerts, in Account: this device on or off, what to be told about, and a test.
 *
 * ⚠️ RENDERS NOTHING UNTIL IT CAN WORK — no key yet, or a browser with no push. A switch that
 * cannot do anything is the failure this page keeps being about (see PublishCard). The one
 * exception is Safari on an iPhone in a tab, which CAN have alerts once the site is on the Home
 * Screen, so it is told how rather than shown nothing.
 */
export function PhoneAlertsCard() {
  const api = useAlertsApi()
  const offer = api ? api.offer() : 'none'
  const [here, setHere] = useState<boolean | null>(null)
  const [prefs, setPrefs] = useState<Prefs | 'not-yet' | 'failed' | null>(null)
  const [busy, setBusy] = useState<'device' | 'test' | null>(null)
  /* ⚠️ A SET, NOT ONE SLOT: two kinds can be saving at once, and with a single `busy` the first
     answer to come back re-enabled the second switch while its save was still in flight */
  const [saving, setSaving] = useState<ReadonlySet<Kind>>(() => new Set())
  const [say, setSay] = useState('')
  const kindsLabel = useId()

  useEffect(() => {
    if (!api || offer !== 'ok') return
    let live = true
    void Promise.all([api.onHere().catch(() => false), api.prefs()]).then(([h, p]) => {
      if (!live) return
      setHere(h)
      setPrefs(p)
    })
    return () => {
      live = false
    }
  }, [api, offer])

  if (!api || offer === 'none') return null

  const blocked = api.permission() === 'denied'

  const flipDevice = () => {
    if (busy) return
    const wasOn = here === true
    setBusy('device')
    setSay(wasOn ? 'Turning off…' : 'Turning on…')
    /* ⚠️ CALLED HERE, IN THE CLICK, with nothing awaited first: enable() asks for permission as
       its first step, and Firefox only shows that prompt while the click is still being handled */
    void (wasOn ? api.disable() : api.enable()).then((r) => {
      setBusy(null)
      if (r.ok) {
        setHere(!wasOn)
        setSay(wasOn ? 'Off for this device.' : 'On for this device.')
      } else if (r.why === 'not-yet') {
        setPrefs('not-yet')
        setSay('')
      } else if (r.why === 'denied') {
        /* a blocked browser says so in the line above the switch; a dismissed prompt can be asked again */
        setSay(api.permission() === 'denied' ? '' : 'Not allowed.')
      } else {
        setSay(`Couldn’t turn ${wasOn ? 'off' : 'on'}: ${r.message ?? 'try again.'}`)
      }
    })
  }

  const flipKind = (kind: Kind) => {
    if (!prefs || typeof prefs !== 'object' || saving.has(kind)) return
    const next = !prefs[kind]
    setPrefs({ ...prefs, [kind]: next })
    setSaving((s) => new Set(s).add(kind))
    setSay('')
    void api.setPref(kind, next).then((r) => {
      setSaving((s) => {
        const left = new Set(s)
        left.delete(kind)
        return left
      })
      if (r.ok) return
      /* put back what the server still has, so the switch never shows a choice that was not kept */
      setPrefs((p) => (p && typeof p === 'object' ? { ...p, [kind]: !next } : p))
      setSay(r.why === 'not-yet' ? 'Not switched on yet.' : 'Couldn’t save that. Try again.')
    })
  }

  const sendTest = () => {
    if (busy) return
    setBusy('test')
    setSay('Sending…')
    void api.sendTest().then((r) => {
      setBusy(null)
      setSay(
        r.ok
          ? r.devices === 0
            ? 'No device has alerts on.'
            : 'Test sent. It should arrive within a minute.'
          : r.why === 'not-yet'
            ? 'Not switched on yet.'
            : 'Couldn’t send. Try again.',
      )
    })
  }

  return (
    <article className="card" style={{ display: 'grid', gap: 10 }}>
      <h3 style={{ margin: 0 }}>📱 Phone alerts</h3>
      {offer === 'install' ? (
        <p className="muted" style={line}>
          On iPhone or iPad, add this site to your Home Screen and open it from there.
        </p>
      ) : prefs === 'not-yet' ? (
        <p className="muted" style={line}>
          Not switched on yet.
        </p>
      ) : here === null || prefs === null ? (
        <p className="muted" style={line} aria-busy>
          Checking…
        </p>
      ) : (
        <>
          {/* the one fact a person cannot see from here: it works with the site closed */}
          <p className="muted" style={line}>
            Alerts arrive with the site closed.
          </p>
          {blocked && (
            <p className="muted" style={line}>
              Notifications are blocked for this site in your browser settings.
            </p>
          )}
          <Switch
            label="This device"
            on={here}
            disabled={busy === 'device' || (blocked && !here)}
            onFlip={flipDevice}
          />
          {here && prefs === 'failed' && (
            <p className="muted" style={line}>
              Couldn’t load your choices. Reload to try again.
            </p>
          )}
          {here && typeof prefs === 'object' && (
            /* the label is SEEN as well as read out: drawn as six identical rows, the five kinds
               looked like more devices, or like more of the same switch */
            <div role="group" aria-labelledby={kindsLabel} style={{ display: 'grid', gap: 2 }}>
              <p id={kindsLabel} className="muted" style={{ ...line, marginTop: 4 }}>
                Alert me about
              </p>
              {KINDS.map(({ kind, label }) => (
                <Switch
                  key={kind}
                  label={label}
                  on={prefs[kind]}
                  disabled={saving.has(kind)}
                  onFlip={() => flipKind(kind)}
                />
              ))}
            </div>
          )}
          {here && (
            <p style={{ margin: 0 }}>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy !== null}
                onClick={sendTest}
              >
                Send a test
              </button>
            </p>
          )}
        </>
      )}
      {/* always in the page, so a screen reader is already listening when it changes */}
      <p className="muted" style={line} role="status">
        {say}
      </p>
    </article>
  )
}
