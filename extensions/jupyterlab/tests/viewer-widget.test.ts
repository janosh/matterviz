// @vitest-environment happy-dom
// Covers the render lifecycle: a stale render must never write into the viewer
// node, and a context that never becomes ready must say so instead of leaving a
// blank panel. `./viewer` is mocked so the tests stay off the MatterViz component
// graph, and the @jupyterlab/* imports because loading them drags in @microsoft/fast,
// which throws on every animation frame outside a real browser. Only @lumino/widgets
// stays real — the widget extends it.
import type { DocumentRegistry } from '@jupyterlab/docregistry'
import { beforeEach, expect, test, vi } from 'vitest'

const create_display = vi.fn((root: HTMLElement) => {
  root.textContent = `mounted`
  return { app: true }
})
let finish_unmount: () => void = () => {}
const unmount = vi.fn(() => new Promise<void>((resolve) => (finish_unmount = resolve)))

vi.mock(`../src/viewer`, () => ({
  create_display,
  parse_file_content: vi.fn(() => Promise.resolve({ kind: `structure` })),
  unmount,
}))
vi.mock(`@jupyterlab/ui-components`, () => ({
  LabIcon: class {
    constructor(public readonly options: { name: string; svgstr: string }) {}
  },
}))
vi.mock(`@jupyterlab/apputils`, () => ({ WidgetTracker: class {} }))
vi.mock(`@jupyterlab/application`, () => ({ ILayoutRestorer: Symbol(`ILayoutRestorer`) }))
vi.mock(`@jupyterlab/docregistry`, () => ({
  ABCWidgetFactory: class {},
  Base64ModelFactory: class {},
  DocumentWidget: class {},
}))

const { MatterVizViewer } = await import(`../src/index`)

const MAX_PARSE_BYTES = 100 * 1024 * 1024

// Minimal stand-in for Lumino's Signal, which would drag in the whole messaging
// runtime. The widget's handler is an arrow property, so the receiver it passes to
// connect is already bound and can be ignored.
const make_signal = () => {
  const handlers = new Set<() => void>()
  return {
    connect: (handler: () => void) => handlers.add(handler),
    disconnect: (handler: () => void) => handlers.delete(handler),
    emit: () => {
      for (const handler of handlers) handler()
    },
  }
}

const make_context = (content: string, ready: Promise<void>) => {
  const contentChanged = make_signal()
  return {
    path: `structures/Li2O.cif`,
    ready,
    contentsModel: { format: `text` },
    model: { contentChanged, toString: () => content },
    set_content: (next: string) => {
      content = next
      contentChanged.emit()
    },
  }
}

const new_viewer = (context: ReturnType<typeof make_context>) =>
  new MatterVizViewer(context as unknown as DocumentRegistry.Context)

beforeEach(() => vi.clearAllMocks())

test(`an oversize file's error must not clobber the render that superseded it`, async () => {
  const context = make_context(`data`, Promise.resolve())
  const viewer = new_viewer(context)
  await vi.waitFor(() => expect(create_display).toHaveBeenCalledTimes(1))

  // Second render trips the size guard, so it unmounts before writing its error.
  context.set_content(`x`.repeat(MAX_PARSE_BYTES + 1))
  await vi.waitFor(() => expect(unmount).toHaveBeenCalledTimes(1))

  // Third render wins the race while that unmount is still in flight.
  context.set_content(`data`)
  await vi.waitFor(() => expect(create_display).toHaveBeenCalledTimes(2))

  finish_unmount()
  await new Promise((resolve) => setTimeout(resolve))

  expect(viewer.node.querySelector(`.mv-file-viewer-error`)).toBeNull()
  expect(viewer.node.textContent).toBe(`mounted`)
})

test(`a context that fails to become ready reports the failure`, async () => {
  const context = make_context(`data`, Promise.reject(new Error(`File not found`)))
  const viewer = new_viewer(context)

  await vi.waitFor(() =>
    expect(viewer.node.querySelector(`.mv-file-viewer-error`)).not.toBeNull(),
  )
  expect(viewer.node.textContent).toContain(`Cannot display Li2O.cif`)
  expect(viewer.node.textContent).toContain(`File not found`)
  expect(create_display).not.toHaveBeenCalled()
})
