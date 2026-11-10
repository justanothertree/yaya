import { describe, expect, it } from 'vitest'
import { dayAsked, dayHref } from './dayLink'

describe('dayLink', () => {
  it('reads back the day it was built from', () => {
    expect(dayAsked(dayHref('2026-11-06'))).toBe('2026-11-06')
  })

  it('reads the day among other parameters, and without the leading #', () => {
    expect(dayAsked('#chronicle?tab=x&day=2024-02-29')).toBe('2024-02-29')
    expect(dayAsked('chronicle?day=2026-01-31')).toBe('2026-01-31')
  })

  it('refuses a date that does not exist rather than rolling it over', () => {
    expect(dayAsked('#chronicle?day=2026-02-30')).toBeNull()
    expect(dayAsked('#chronicle?day=2025-02-29')).toBeNull()
    expect(dayAsked('#chronicle?day=2026-13-01')).toBeNull()
  })

  it('refuses anything that is not a plain date', () => {
    expect(dayAsked('#chronicle?day=2026-11-6')).toBeNull()
    expect(dayAsked('#chronicle?day=yesterday')).toBeNull()
    expect(dayAsked('#chronicle?day=')).toBeNull()
    expect(dayAsked('#chronicle')).toBeNull()
  })

  it('belongs to Chronicle only', () => {
    expect(dayAsked('#circuit?day=2026-11-06')).toBeNull()
    expect(dayAsked('')).toBeNull()
  })
})
