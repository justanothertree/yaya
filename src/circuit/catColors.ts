// Shared exercise-category colors for the Circuit (Board/Feed/Charts/profiles all use these).
// Single source of truth so the palette can't drift between views.
export const CAT_COLORS: Record<string, string> = {
  arms: '#f46b6b',
  core: '#a78bfa',
  legs: '#5b9cf6',
  bike: '#2ec4b6',
  skate: '#fb923c',
  run: '#22cc78',
  walk: '#f5c060',
  other: '#9aa0aa',
}

export const catColor = (c?: string): string => CAT_COLORS[c || 'other'] || '#9aa0aa'
