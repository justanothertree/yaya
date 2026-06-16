// Provision template member accounts (YOU run this — it uses your service-role key).
//
// Creates 33 family + 50 friend accounts: an auth user (synthetic email + random temp
// password), a global username in player_registry, an empty profile, and a class tag in
// user_roles. Idempotent-ish: existing accounts are skipped. Writes credentials to
// members-credentials.csv for you to record and hand out (then have people change them).
//
// USAGE (from the repo root, never commit your service key):
//   1) Supabase Dashboard → Project Settings → API → copy the **service_role** key.
//   2) PowerShell:  $env:SUPABASE_SERVICE_ROLE_KEY="<key>"; node scripts/provision-members.mjs
//      bash:        SUPABASE_SERVICE_ROLE_KEY="<key>" node scripts/provision-members.mjs
//
// The Supabase URL is read from .env.local (VITE_SUPABASE_URL); override with SUPABASE_URL.

import { createClient } from '@supabase/supabase-js'
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const FAMILY_COUNT = 33
const FRIEND_COUNT = 50
const EMAIL_DOMAIN = 'members.evancook.dev' // synthetic login domain (not routed); people can link a real email later

function getUrl() {
  if (process.env.SUPABASE_URL) return process.env.SUPABASE_URL
  try {
    const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    const m = env.match(/^\s*VITE_SUPABASE_URL\s*=\s*(.+)\s*$/m)
    if (m) return m[1].trim().replace(/^["']|["']$/g, '')
  } catch {}
  throw new Error('Set SUPABASE_URL (or VITE_SUPABASE_URL in .env.local)')
}

const url = getUrl()
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!serviceKey) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY env var. Aborting (no accounts created).')
  process.exit(1)
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const tempPassword = () => randomBytes(12).toString('base64url') // ~16 chars, strong

const accounts = [
  ...Array.from({ length: FAMILY_COUNT }, (_, i) => ({ username: `family${i + 1}`, klass: 'family' })),
  ...Array.from({ length: FRIEND_COUNT }, (_, i) => ({ username: `friend${i + 1}`, klass: 'friend' })),
]

const created = []
let skipped = 0

for (const { username, klass } of accounts) {
  const email = `${username}@${EMAIL_DOMAIN}`
  const password = tempPassword()

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username, class: klass },
  })
  if (error) {
    console.warn(`skip ${username}: ${error.message}`)
    skipped++
    continue
  }
  const userId = data.user.id

  // claim the username in the one global namespace (blocks anon Snake collisions)
  const { error: regErr } = await admin
    .from('player_registry')
    .upsert({ player_name: username }, { onConflict: 'player_name', ignoreDuplicates: true })
  if (regErr) console.warn(`  player_registry(${username}): ${regErr.message}`)

  const { error: profErr } = await admin.from('profiles').upsert({ user_id: userId, username })
  if (profErr) console.warn(`  profiles(${username}): ${profErr.message}`)

  const { error: roleErr } = await admin.from('user_roles').insert({ user_id: userId, role: klass })
  if (roleErr) console.warn(`  user_roles(${username}): ${roleErr.message}`)

  created.push({ username, email, password, class: klass })
  console.log(`created ${username} (${klass})`)
}

// write credentials for you to record + distribute (keep this file private!)
const csv =
  'username,email,password,class\n' +
  created.map((c) => `${c.username},${c.email},${c.password},${c.class}`).join('\n') +
  '\n'
writeFileSync(new URL('../members-credentials.csv', import.meta.url), csv)

console.log(
  `\nDone. Created ${created.length}, skipped ${skipped}. ` +
    `Credentials → members-credentials.csv (KEEP PRIVATE; delete after distributing).`,
)
