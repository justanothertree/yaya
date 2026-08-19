/**
 * DEV-only probe for the profile look module, so the colour/banner logic can be exercised
 * against real inputs without an admin session or a signed-in profile page.
 *
 * Exposed on window under import.meta.env.DEV only — it never exists in a production build.
 */
import { BANNER_STYLES, avatarStyle, bannerBackground, hueFor } from '../profile/look'

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__look = {
    hueFor,
    avatarStyle,
    bannerBackground,
    styles: Object.keys(BANNER_STYLES),
    css: (k: string, h: number) =>
      (BANNER_STYLES as Record<string, { css: (h: number) => string }>)[k].css(h),
  }
}
