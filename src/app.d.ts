/// <reference types="@sveltejs/kit" />

import type { PymatgenStructure } from './lib/structure'

declare module '$site/structures/mp-*.json' {
  export default PymatgenStructure
}
