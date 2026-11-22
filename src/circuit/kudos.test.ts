import { describe, expect, it } from 'vitest'
import { kudosGroups, kudosLine } from './kudos'

const ME = 'me-uid'
const row = (emoji: string, user_id: string, author_name: string | null) => ({
  emoji,
  user_id,
  author_name,
})

describe('who gave which kudos, in words', () => {
  it('says the example from the decision: "🔥 Jordan, Samantha · 💪 you"', () => {
    const g = kudosGroups(
      [row('🔥', 'j', 'Jordan'), row('🔥', 's', 'Samantha'), row('💪', ME, 'Preview You')],
      ME,
    )
    expect(kudosLine(g)).toBe('🔥 Jordan, Samantha · 💪 you')
  })

  it('counts every kudos, marks yours, and puts "you" after the others whatever the order', () => {
    const g = kudosGroups(
      [row('🔥', ME, 'Me'), row('🔥', 'j', 'Jordan'), row('👏', 's', 'Sam')],
      ME,
    )
    expect(g).toEqual([
      { emoji: '🔥', count: 2, mine: true, names: ['Jordan', 'you'] },
      { emoji: '👏', count: 1, mine: false, names: ['Sam'] },
    ])
  })

  it('names somebody with no name, or only spaces, "Member", as the chip always did', () => {
    const g = kudosGroups([row('👍', 'a', null), row('👍', 'b', '   ')], ME)
    expect(g[0].names).toEqual(['Member', 'Member'])
  })

  it('never calls anybody "you" when nobody is signed in', () => {
    const g = kudosGroups([row('🐐', 'x', 'Ola')], null)
    expect(kudosLine(g)).toBe('🐐 Ola')
    expect(g[0].mine).toBe(false)
  })

  it('says nothing when there are no kudos', () => {
    expect(kudosLine(kudosGroups([], ME))).toBe('')
  })
})
