/// <reference types="@sveltejs/kit" />

declare module 'mp-*.json' {
  const content: import('$lib/structure').Crystal
  export default content
}

declare module '*-colors.yml' {
  const content: import('$lib/colors').ElementColorScheme
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
export {}
