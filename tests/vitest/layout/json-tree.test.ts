import { JsonTree } from '#lib/layout/index.js'
import SharedJsonTree from 'svelte-widgets/JsonTree.svelte'
import { expect, test } from 'vitest'

// rendering is svelte-widgets' to test; matterviz only re-exports its viewer
test(`layout re-exports the shared JSON viewer`, () => {
  expect(JsonTree).toBe(SharedJsonTree)
})
