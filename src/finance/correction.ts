/**
 * What to say before somebody overwrites a position by hand.
 *
 * ⚠️ THIS IS HOW LCID ENDED UP AT 253.78. `admin_correct_position` sets the true unit count for a
 * symbol, and the control that drives it prefilled `String(p.units)` — which renders a position
 * of 253.783975 as "253.783975" but a position of 253.78 as "253.78". Type over it with a figure
 * read off a broker screen, which rounds, and the correction silently throws away the fraction it
 * was never about. The tool exists for splits the export missed, where the number changes by a
 * factor; a change of less than a cent's worth of shares is almost never that.
 *
 * ⚠️ WARNINGS, NOT REFUSALS, and the difference is the whole design. Every case below CAN be
 * legitimate — a genuinely round position, a tiny real correction — and this screen is the only
 * way to fix a broker export that lied. Refusing would turn a rare annoyance into an unfixable
 * one. Saying the number back in full is what a person needs to notice they are about to drop
 * four decimal places.
 *
 * Pure so it can be asked questions: the admin positions table needs an admin session, and
 * `#dev-admin` renders it with no token, so the room is empty and a sweep of it proves nothing.
 */

/** How many decimal places a typed number carries, as typed — "253.78" is 2, "254" is 0. */
export function decimalsOf(typed: string): number {
  const dot = typed.indexOf('.')
  if (dot < 0) return 0
  return typed.slice(dot + 1).replace(/[^0-9]/g, '').length
}

export type CorrectionWarning = {
  /** the heading-level concern, in the fewest words that are still true */
  says: string
  /** what to do about it, or what it will cost */
  because: string
}

/**
 * Is this correction worth a second look?
 *
 * `held` is the position as the fund currently computes it; `typed` is what is in the box, as a
 * string, because the number of decimals TYPED is part of the question and `Number()` discards it.
 */
export function correctionWarning(held: number, typed: string): CorrectionWarning | null {
  const next = Number(typed)
  if (!Number.isFinite(next) || typed.trim() === '') return null

  const heldStr = fullPrecision(held)
  const heldDp = decimalsOf(heldStr)
  const typedDp = decimalsOf(typed.trim())
  const diff = Math.abs(next - held)

  /**
   * ⚠️ THE ROUNDING CASE FIRST, because it is the one that looks most like a correct answer. The
   * typed figure is shorter than the held one AND close to it: that is a broker screen's rounding
   * being pasted over the fund's own arithmetic.
   */
  if (typedDp < heldDp && diff > 0 && diff < 0.01) {
    return {
      says: `That drops ${heldDp - typedDp} decimal place${heldDp - typedDp === 1 ? '' : 's'}.`,
      because: `You hold ${heldStr}, and this would make it ${typed.trim()} — a difference of ${diff.toPrecision(2)} units. If you are copying from a broker screen, it has rounded.`,
    }
  }

  /**
   * ⚠️ AND THE NEAR-MISS SEPARATELY, because a tiny change at the SAME precision is a different
   * mistake: usually a typo, or a figure from a different date. This tool is for splits, which
   * move a position by a factor.
   */
  if (diff > 0 && diff < 0.01) {
    return {
      says: 'That is almost exactly what you already hold.',
      because: `${heldStr} → ${typed.trim()}, a difference of ${diff.toPrecision(2)} units. This tool is for a split the export missed, which changes the count by a factor.`,
    }
  }

  if (diff === 0) {
    return {
      says: 'That is the number you already hold.',
      because: 'Saving it changes nothing.',
    }
  }

  return null
}

/**
 * The held position written out in full, for the prefill and for the sentences above.
 *
 * ⚠️ NOT `String(n)`, WHICH IS WHERE THE PRECISION WENT. `String(253.78)` is "253.78" — correct
 * but indistinguishable on screen from a rounded figure — and `String(1e-7)` is "1e-7", which is
 * not a number anybody can edit. Six places is what the broker exports carry and what
 * `finance.allocations` is rounded to elsewhere.
 */
export function fullPrecision(n: number): string {
  if (!Number.isFinite(n)) return '0'
  const v = Math.max(0, n)
  /* ⚠️ `toFixed` GIVES UP AND RETURNS EXPONENT NOTATION AT 1e21, which is unreachable for a
     fund whose largest position is in the thousands — but a prefill of "1e+21" cannot be edited
     in a `type="number"` box, and the test for it is cheaper than the reasoning about whether it
     can happen. Caught by that test, not by reading. */
  if (v >= 1e21) return BigInt(Math.round(v)).toString()
  const fixed = v.toFixed(6)
  /* trim trailing zeros but keep at least one decimal, so a whole number still reads as exact */
  return fixed.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
}
