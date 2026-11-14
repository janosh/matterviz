import SceneLabel from '#lib/scene/SceneLabel.svelte'
import { createRawSnippet, flushSync, mount, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vite-plus/test'
import { threlte_stub } from '../isosurface/threlte-stub'

vi.mock(`@threlte/extras`, async () => ({
  HTML: Reflect.get((await import(`../isosurface/threlte-stub`)).threlte_stub.T, `HTML`),
}))

afterEach(() => threlte_stub.reset())

// Labels over the canvas must not swallow hovers meant for the geometry under them, so only
// an `interactive` label keeps pointer events; other props and children pass through
test.each([
  [{}, `pointer-events: none; `],
  [{ style: `color: red` }, `pointer-events: none; color: red`],
  [{ interactive: true, style: `color: red` }, `color: red`],
])(`%o renders HTML with style %j`, (props, style) => {
  const children = createRawSnippet(() => ({ render: () => `<span class="chip">Γ</span>` }))
  const component = mount(SceneLabel, {
    target: document.body,
    props: { ...props, center: true, children },
  })
  flushSync()
  const [node] = threlte_stub.nodes
  expect(node.tag).toBe(`HTML`)
  expect(node.props).toMatchObject({ style, center: true })
  expect(node.props).not.toHaveProperty(`interactive`)
  expect(document.querySelector(`.chip`)?.textContent).toBe(`Γ`)
  void unmount(component)
})
