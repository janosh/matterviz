/// <reference types="@sveltejs/kit" />

declare module '$site/structures/mp-*.json' {
  import type { PymatgenStructure } from '$lib'
  const test_structure: PymatgenStructure
  export default test_structure
}
