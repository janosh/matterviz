import { JsonTree } from '$lib/layout'
import { JsonTree as SharedJsonTree } from 'svelte-widgets'
import { mount, flushSync, unmount } from 'svelte'
import { expect, test, onTestFinished } from 'vitest'

test(`layout exports the shared JSON viewer with nested data`, () => {
  expect(JsonTree).toBe(SharedJsonTree)
  const component = mount(JsonTree, {
    target: document.body,
    props: {
      value: { name: `structure`, lattice: { volume: 42 } },
      default_fold_level: 5,
    },
  })
  onTestFinished(() => unmount(component))
  flushSync()
  expect(
    document.querySelector(`.json-node[data-path="lattice.volume"]`)?.textContent,
  ).toContain(`42`)
})
