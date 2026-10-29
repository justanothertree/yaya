/**
 * What pressing a symbol's family/personal toggle is about to do.
 *
 * ⚠️ IT WAS ONE CLICK, NO CONFIRMATION, AND IT DELETES ACROSS EVERY ACCOUNT. Turning a symbol OFF
 * runs `delete from finance.allocations ... where et.asset_symbol = v_sym and et.platform = v_plat`
 * — unconditionally, for all 33 family accounts. Measured on the live fund, 28 Oct 2026: SPCE on
 * Cash App is **6,006 allocation rows**, BTC 1,320, OCCI 297. The button sat in a table row next
 * to "Set", with nothing between a misclick and the deletion.
 *
 * ⚠️ AND OFF IS NOT AN UNDO OF ON, WHICH IS THE PART A PERSON CANNOT GUESS. On delegates to
 * `admin_even_split_trades`, which only picks up trades that have NO allocations. Off deletes
 * EVERY allocation for the symbol — including ones that existed long before, including ones made
 * by an import or by hand. So the obvious recovery from a mistaken On ("just turn it back off")
 * destroys more than the mistake did.
 *
 * ⚠️ PURE, BECAUSE THE ROOM IT LIVES IN NEEDS AN ADMIN SESSION. `#dev-admin` renders the real
 * panel with no token, so every RPC answers nothing and the positions table is empty — a room
 * with nothing in it passes every check there is. The sentence a person reads before destroying
 * six thousand rows is worth testing, so it is computed here and `designation.test.ts` asks it.
 */

/** Only the fields of a `Position` this decision looks at. */
export type Designated = {
  symbol: string
  platform: string
  /** how many allocation rows the family holds for this symbol — see `familyRows` on the RPC */
  familyRows: number
  /** net units the family owns; zero does NOT mean nothing is at stake */
  familyUnits: number
}

export type DesignationPlan = {
  /** whether to stop and ask before doing it */
  asks: boolean
  /** true when rows are about to be destroyed */
  destroys: boolean
  /** the heading on the confirmation — what the button does */
  title: string
  /** what it costs, in one sentence a person can act on */
  says: string
  /** the word on the button that goes through with it */
  go: string
}

const plural = (n: number, one: string, many = one + 's') =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`

export function designationPlan(pos: Designated, turningOn: boolean): DesignationPlan {
  const where = `${pos.symbol} on ${pos.platform === 'cashapp' ? 'Cash App' : pos.platform === 'robinhood' ? 'Robinhood' : pos.platform}`

  if (turningOn) {
    return {
      /**
       * ⚠️ ON ASKS TOO, EVEN THOUGH IT DESTROYS NOTHING. It splits every unallocated trade of this
       * symbol across all 33 accounts, and the only way back is Off — which deletes more than this
       * created. An action whose undo is destructive is one to be sure about.
       */
      asks: true,
      destroys: false,
      title: `Give ${where} to the family?`,
      says:
        `Every trade of it that isn't already split gets shared across all the family accounts.` +
        ` Turning it off again later removes every family allocation for ${pos.symbol} — including` +
        ` any that were there before — so this is not a step you can simply take back.`,
      go: 'Yes, share it',
    }
  }

  /**
   * ⚠️ ROWS, NOT UNITS. A position bought and sold out has `familyUnits` of zero and can still
   * hold thousands of allocation rows carrying the cost history that `heldBasis` and the
   * per-holding percentages are built from. "0 units at stake" about 6,000 rows of basis would be
   * a more confident wrong answer than saying nothing.
   */
  if (pos.familyRows <= 0) {
    return {
      asks: false,
      destroys: false,
      title: `Take ${where} back?`,
      says: `The family has no share of it, so nothing is removed.`,
      go: 'Take it back',
    }
  }

  const units =
    pos.familyUnits > 0
      ? ` That is ${pos.familyUnits.toLocaleString(undefined, { maximumFractionDigits: 4 })} units.`
      : /* a closed position: no units left, and the whole cost history still goes */
        ` The family holds no units of it now, but those rows are what its cost history is made of.`

  return {
    asks: true,
    destroys: true,
    title: `Take ${where} back from the family?`,
    says:
      `This deletes ${plural(pos.familyRows, 'allocation')} for ${pos.symbol}, across every` +
      ` family account.${units} Nothing restores them — sharing it again only splits the trades` +
      ` that have no allocations left.`,
    go: `Yes, delete ${plural(pos.familyRows, 'allocation')}`,
  }
}
