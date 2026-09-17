import JsonBrowser from '$lib/file-viewer/JsonBrowser.svelte'
import { mount_viewer } from '$lib/file-viewer/mount-viewer'
import { flushSync, mount, unmount } from 'svelte'
import type * as SvelteModule from 'svelte'
import { afterEach, beforeEach, expect, onTestFinished, test, vi } from 'vitest'
import { doc_query } from '../setup'

// Pass-through spy: a panel render is one mount_viewer call, so the count tells how many
// viewers a burst of tree selections really built
vi.mock(`$lib/file-viewer/mount-viewer`, { spy: true })
// Pass-through spy on unmount: panel viewers are mounted imperatively, so only an unmount
// call proves a closed or replaced panel released its viewer
// Avoid await in hoisted factories: Svelte's injected tracking needs initialized imports.
vi.mock(`svelte`, (import_original) =>
  import_original<typeof SvelteModule>().then((original) => ({
    ...original,
    unmount: vi.fn(original.unmount),
  })),
)

// Cleared before (not after) each test: mount_browser's onTestFinished unmount runs after
// afterEach, so an afterEach reset would leave the previous browser's teardown on the spy
beforeEach(() => {
  vi.mocked(mount_viewer).mockClear()
  vi.mocked(unmount).mockClear()
})
afterEach(() => vi.useRealTimers())

const table_rows = (start: number, count: number) =>
  Array.from({ length: count }, (_, idx) => ({ x: start + idx, y: start + idx + 1 }))

const drag_event = (
  type: `dragover` | `drop`,
  payload = ``,
  position = [5, 50],
): DragEvent => {
  const event = new DragEvent(type, {
    bubbles: true,
    cancelable: true,
  })
  Object.defineProperties(event, {
    clientX: { value: position[0] },
    clientY: { value: position[1] },
    dataTransfer: { value: { dropEffect: `none`, getData: () => payload } },
  })
  return event
}

const pointer = (
  element: Element,
  type: `pointerdown` | `pointermove` | `pointerup`,
  client_x = 5,
): void => {
  element.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      clientX: client_x,
    }),
  )
  flushSync()
}

// Real rAF/MutationObserver on purpose: the badge pass mutates the subtree it observes, so a
// stubbed no-op rAF would hide a re-schedule loop
const mount_browser = (initial: { value: unknown; filename?: string }) => {
  const props = $state({ ...initial })
  const component = mount(JsonBrowser, { target: document.body, props })
  onTestFinished(() => unmount(component))
  return { component, props }
}

const next_frames = (count: number): Promise<void> =>
  new Promise((resolve) => {
    const step = (remaining: number) =>
      remaining === 0 ? resolve() : requestAnimationFrame(() => step(remaining - 1))
    step(count)
  })

// The placeholder's first chip renders the first renderable path into the main panel
const click_first_chip = async (): Promise<void> => {
  const chip = await vi.waitFor(() => doc_query(`.renderable-chip`))
  chip.click()
}

// Drop a tree node's table onto the edge of the first panel, splitting it
const drop_table_onto_panel = async (data_path: string, position = [5, 50]): Promise<void> => {
  const panel = await vi.waitFor(() => doc_query(`.viz-panel`))
  vi.spyOn(panel, `getBoundingClientRect`).mockReturnValue(new DOMRect(0, 0, 100, 100))
  const canvas = doc_query(`.canvas`)
  canvas.dispatchEvent(drag_event(`dragover`, ``, position))
  canvas.dispatchEvent(
    drag_event(`drop`, JSON.stringify({ data_path, detected_type: `table` }), position),
  )
}

test.each([
  [`horizontal`, [5, 50], [50, 5]],
  [`vertical`, [50, 5], [5, 50]],
] as const)(
  `%s splits preserve their axis until only one panel remains`,
  async (direction, position, cross_axis) => {
    mount_browser({ value: { first: table_rows(1, 3), second: table_rows(4, 4) } })
    await click_first_chip()
    await drop_table_onto_panel(`second`, [...position])

    const split_divider = await vi.waitFor(() => doc_query(`.split-divider`))
    expect(split_divider.classList.contains(direction)).toBe(true)
    pointer(split_divider, `pointerdown`)
    const browser = doc_query(`.json-browser`)
    expect(split_divider.classList.contains(`active`)).toBe(true)
    expect(browser.classList.contains(`dragging`)).toBe(true)

    // the divider captures the pointer, so the release is delivered to it, not the window
    pointer(split_divider, `pointerup`)
    expect(split_divider.classList.contains(`active`)).toBe(false)
    expect(browser.classList.contains(`dragging`)).toBe(false)
    // the sidebar is resized by the shared PaneDivider, not a bespoke mouse handler
    expect(doc_query(`.pane-divider`).getAttribute(`aria-orientation`)).toBe(`vertical`)

    // A perpendicular edge replaces the first panel rather than introducing a mixed axis.
    await drop_table_onto_panel(`first`, [...cross_axis])
    flushSync()
    expect(document.querySelectorAll(`.viz-panel`)).toHaveLength(2)
    expect(doc_query(`.split-divider`).classList.contains(direction)).toBe(true)
    vi.mocked(mount_viewer).mock.lastCall?.[3]?.on_close?.()
    flushSync()
    expect(document.querySelectorAll(`.viz-panel`)).toHaveLength(1)
    await drop_table_onto_panel(`second`, [...cross_axis])
    flushSync()
    expect(doc_query(`.split-divider`).classList.contains(direction)).toBe(false)
  },
)

// Regression: the root node is labelled with the verbatim filename, and `data.json` used
// to be split at its dot, so no badge matched its tree node and clicking nodes never
// resolved a value (click-to-render was dead for every real filename)
const keyed = { first: table_rows(1, 3), other: 1 }
test.each([
  [`data.json`, keyed, `data.json.first`, `first`],
  [`results.v2.json`, keyed, `results.v2.json.first`, `first`],
  [`data.json`, [table_rows(1, 3)], `data.json[0]`, `[0]`],
  [undefined, keyed, `first`, `first`],
])(
  `filename %s: badges attach to tree node %s and clicking it renders`,
  async (filename, value, tree_path, data_path) => {
    mount_browser({ value, filename })

    const badge = await vi.waitFor(() =>
      doc_query(`.renderable-badge[data-renderable_type="table"]`),
    )
    const node = badge.closest<HTMLElement>(`[data-path]`)
    expect(node?.dataset.path).toBe(tree_path)
    expect(node?.draggable).toBe(true)
    const transfer = { setData: vi.fn(), effectAllowed: `none` }
    for (const origin of [node, badge]) {
      const event = new DragEvent(`dragstart`, { bubbles: true, cancelable: true })
      Object.defineProperty(event, `dataTransfer`, { value: transfer })
      origin?.dispatchEvent(event)
      expect(transfer.setData).toHaveBeenLastCalledWith(
        `text/plain`,
        JSON.stringify({ data_path, detected_type: `table` }),
      )
      expect(transfer.effectAllowed).toBe(`copy`)
    }

    // Badge injection mutates the observed subtree; it must settle instead of re-applying
    // (and replacing every badge) on each animation frame
    const badge_count = document.querySelectorAll(`.renderable-badge`).length
    await next_frames(3)
    expect(document.querySelectorAll(`.renderable-badge`)).toHaveLength(badge_count)
    expect(document.contains(badge)).toBe(true)

    // Clicking the node resolves its value through the dotted root label and renders it
    node?.click()
    const label = await vi.waitFor(() => doc_query(`.panel-label`))
    expect(label.textContent).toBe(`Table: ${data_path}`)
  },
)

// JsonTree reports a selection on every ArrowUp/ArrowDown and twice on a double-click, and
// each render unmounts and remounts a full viewer, so a burst of selections must build one
test(`rapid tree selections render only the last one after a 150 ms debounce`, async () => {
  vi.useFakeTimers()
  const value = { first: table_rows(1, 3), second: table_rows(4, 3), third: table_rows(7, 3) }
  mount_browser({ value })
  flushSync()
  // 100 ms apart: slower than the debounce, but each would be its own viewer without it
  for (const path of [`first`, `second`, `third`]) {
    doc_query(`[data-path="${path}"]`).click()
    await vi.advanceTimersByTimeAsync(100)
  }
  await vi.advanceTimersByTimeAsync(49)
  expect(document.querySelector(`.viz-panel`)).toBeNull()
  expect(mount_viewer).not.toHaveBeenCalled()

  await vi.advanceTimersByTimeAsync(100)
  expect(mount_viewer).toHaveBeenCalledTimes(1)
  expect(doc_query(`.panel-label`).textContent).toBe(`Table: third`)
})

// Re-selecting a panel keeps its viewer; replacement, Escape and destruction release it.
test(`reselecting, replacing, closing and destroying panels manage viewer lifetimes`, async () => {
  const browser = mount(JsonBrowser, {
    target: document.body,
    props: { value: { first: table_rows(1, 3), second: table_rows(4, 3) } },
  })
  const viewer_apps = () => vi.mocked(mount_viewer).mock.results.map(({ value }) => value)
  const badges = await vi.waitFor(() => {
    const found = document.querySelectorAll<HTMLElement>(
      `.renderable-badge[data-renderable_type="table"]`,
    )
    expect(found).toHaveLength(2)
    return [...found]
  })
  badges[0].click()
  await vi.waitFor(() => expect(mount_viewer).toHaveBeenCalledTimes(1))
  badges[0].click()
  await next_frames(2)
  expect(mount_viewer).toHaveBeenCalledTimes(1)
  expect(unmount).not.toHaveBeenCalled()

  // Both tree-node and badge clicks replace the viewer when selecting a different path.
  doc_query(`[data-path="second"]`).click()
  await vi.waitFor(() => expect(mount_viewer).toHaveBeenCalledTimes(2))
  expect(unmount).toHaveBeenCalledExactlyOnceWith(viewer_apps()[0])
  expect(doc_query(`.panel-label`).textContent).toBe(`Table: second`)
  // Tree selection can rebuild badges; query the live one before switching back.
  doc_query(`.renderable-badge[data-renderable_path="first"]`).click()
  await vi.waitFor(() => expect(mount_viewer).toHaveBeenCalledTimes(3))
  expect(unmount).toHaveBeenCalledTimes(2)
  expect(unmount).toHaveBeenLastCalledWith(viewer_apps()[1])
  expect(doc_query(`.panel-label`).textContent).toBe(`Table: first`)

  globalThis.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Escape` }))
  await vi.waitFor(() => expect(unmount).toHaveBeenCalledTimes(3))
  expect(unmount).toHaveBeenLastCalledWith(viewer_apps()[2])
  expect(document.querySelector(`.viz-panel`)).toBeNull()

  await click_first_chip()
  await vi.waitFor(() => expect(mount_viewer).toHaveBeenCalledTimes(4))
  await unmount(browser)
  expect(unmount).toHaveBeenCalledWith(viewer_apps()[3])
})

// A new document replaces captured panel data and can auto-render its own root.
test(`a replaced value closes the panels rendering the previous document`, async () => {
  const { props } = mount_browser({ value: { first: table_rows(1, 3) } })
  await click_first_chip()
  await vi.waitFor(() => expect(mount_viewer).toHaveBeenCalledTimes(1))
  expect(doc_query(`.panel-label`).textContent).toBe(`Table: first`)

  props.value = { replacement: table_rows(9, 3) }
  flushSync()
  await next_frames(2)
  expect(unmount).toHaveBeenCalledTimes(1)
  expect(document.querySelector(`.panel-label`)).toBeNull()
  await click_first_chip()
  await vi.waitFor(() =>
    expect(doc_query(`.panel-label`).textContent).toBe(`Table: replacement`),
  )
  // Root tables open automatically on document change, but stay closed after Escape.
  props.value = table_rows(12, 3)
  await vi.waitFor(() => expect(mount_viewer).toHaveBeenCalledTimes(3))
  globalThis.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Escape` }))
  await next_frames(2)
  expect(document.querySelector(`.viz-panel`)).toBeNull()
  expect(mount_viewer).toHaveBeenCalledTimes(3)
})

// A viewer that throws while mounting must say so inside its panel (a blank panel reads as an
// empty dataset), and a viewer that throws while unmounting must not keep the other panels'
// viewers from being released
test(`a failing viewer mount renders an error in its panel and a failing unmount spares siblings`, async () => {
  const console_error = vi.spyOn(console, `error`).mockImplementation(() => {})
  mount_browser({ value: { first: table_rows(1, 3), second: table_rows(4, 4) } })
  vi.mocked(mount_viewer).mockImplementationOnce(() => {
    throw new Error(`viewer exploded`)
  })
  await click_first_chip()
  const panel_error = await vi.waitFor(() => doc_query(`.viz-panel .panel-error`))
  expect(panel_error.textContent).toBe(`Failed to render Table: viewer exploded`)
  expect(console_error).toHaveBeenCalledWith(
    `JsonBrowser: mount failed for table:`,
    expect.any(Error),
  )

  // Replace it with a working viewer, split in a second, then make one unmount throw
  doc_query(`[data-path="second"]`).click()
  await vi.waitFor(() => expect(mount_viewer).toHaveBeenCalledTimes(2))
  expect(document.querySelector(`.panel-error`)).toBeNull()
  await drop_table_onto_panel(`first`)
  await vi.waitFor(() => expect(mount_viewer).toHaveBeenCalledTimes(3))
  vi.mocked(unmount).mockClear()
  vi.mocked(unmount).mockImplementationOnce(() => {
    throw new Error(`teardown exploded`)
  })
  globalThis.dispatchEvent(new KeyboardEvent(`keydown`, { key: `Escape` }))
  await vi.waitFor(() => expect(unmount).toHaveBeenCalledTimes(2))
  expect(document.querySelector(`.viz-panel`)).toBeNull()
  expect(console_error).toHaveBeenCalledWith(
    `JsonBrowser: unmount failed for table:`,
    expect.any(Error),
  )
})

test.each([`unmount`, `replace`])(
  `a pending selection never renders after %s`,
  async (change) => {
    vi.useFakeTimers()
    const props = $state({ value: { first: table_rows(1, 3) } })
    const component = mount(JsonBrowser, {
      target: document.body,
      props,
    })
    flushSync()
    doc_query(`[data-path="first"]`).click()
    if (change === `replace`) props.value = { first: table_rows(9, 3) }
    else await unmount(component)
    await vi.advanceTimersByTimeAsync(300)
    if (change === `replace`) await unmount(component)
    expect(mount_viewer).not.toHaveBeenCalled()
  },
)

// The tree wants ~320 px whatever the editor width (the divider runs in pixel mode, clamped to
// the browser), and dragging can shrink neither the tree below 150 px nor the viewer below 200 px
test.each([
  [1000, `320px`, 50, `150px`, 950, `800px`],
  [500, `300px`, 50, `150px`, 450, `300px`],
])(
  `sidebar in a %i px browser starts at %s and drags clamp to [%s, %s]`,
  (width, seeded, min_client_x, min_size, max_client_x, max_size) => {
    const rect = DOMRect.fromRect({ x: 0, y: 0, width, height: 600 })
    vi.spyOn(HTMLElement.prototype, `getBoundingClientRect`).mockReturnValue(rect)
    mount_browser({ value: { first: table_rows(1, 3) } })
    flushSync()
    const browser = doc_query(`.json-browser`)
    expect(browser.style.getPropertyValue(`--split-pane-size`)).toBe(seeded)

    const divider = doc_query(`.pane-divider`)
    pointer(divider, `pointerdown`, width / 2)
    pointer(divider, `pointermove`, min_client_x)
    expect(browser.style.getPropertyValue(`--split-pane-size`)).toBe(min_size)
    pointer(divider, `pointermove`, max_client_x)
    expect(browser.style.getPropertyValue(`--split-pane-size`)).toBe(max_size)
    pointer(divider, `pointerup`, max_client_x)
  },
)
