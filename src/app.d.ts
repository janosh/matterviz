/// <reference types="@sveltejs/kit" />

import type { Crystal } from '$lib/structure'

declare module 'mp-*.json' {
  const content: Crystal
  export default content
}
