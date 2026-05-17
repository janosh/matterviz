/// <reference types="@sveltejs/kit" />

import type { ElementColorScheme } from '$lib/colors'
import type { Crystal } from '$lib/structure'

declare module 'mp-*.json' {
  const content: Crystal
  export default content
}

declare module '*-colors.yml' {
  const content: ElementColorScheme
  export default content
}

// Global type declarations for theme system and CDN-loaded libraries
declare global {
  interface Window {
    MATTERVIZ_THEMES?: Record<string, Record<string, string>>
    MATTERVIZ_CSS_MAP?: Record<string, string>
  }

  var MATTERVIZ_THEMES: Record<string, Record<string, string>> | undefined

  var MATTERVIZ_CSS_MAP: Record<string, string> | undefined
}
