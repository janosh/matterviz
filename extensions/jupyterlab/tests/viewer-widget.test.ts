// @vitest-environment happy-dom
// Stale renders must not write the viewer node; a context that never becomes ready
// must error instead of leaving a blank panel. Mock `./viewer` and @jupyterlab/*
// (@microsoft/fast throws outside a real browser); keep @lumino/widgets real.
import type { DocumentRegistry } from '@jupyterlab/docregistry'
import { beforeEach, expect, test, vi } from 'vitest'

const create_display = vi.fn((root: HTMLElement) => {
  root.textContent = `mounted`
  return { app: true }
})
let finish_unmount: () => void = () => {}
const unmount = vi.fn(() => new Promise<void>((resolve) => (finish_unmount = resolve)))
const parse_in_worker = vi.fn(
  (
    content: string,
    filename: string,
    _is_base64: boolean,
    _options: { signal: AbortSignal },
  ) => Promise.resolve({ type: `structure`, data: { sites: [] }, filename }),
)

vi.mock(`../src/viewer`, () => ({ create_display, parse_in_worker, unmount }))
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

const { MatterVizViewer, MAX_PARSE_BYTES } = await import(`../src/index`)

// Handler is an arrow property, so the signal's thisArg can be ignored.
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
  expect(parse_in_worker).toHaveBeenCalledExactlyOnceWith(
    `data`,
    `Li2O.cif`,
    false,
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  )

  // Size guard unmounts before writing its error.
  context.set_content(`x`.repeat(MAX_PARSE_BYTES + 1))
  await vi.waitFor(() => expect(unmount).toHaveBeenCalledTimes(1))

  // Newer render wins while that unmount is still in flight.
  context.set_content(`data`)
  await vi.waitFor(() => expect(create_display).toHaveBeenCalledTimes(2))

  finish_unmount()
  await Promise.resolve()

  expect(viewer.node.querySelector(`.mv-file-viewer-error`)).toBeNull()
  expect(viewer.node.textContent).toBe(`mounted`)
  // The oversize revision never reached the parser; disposing aborts the last parse
  expect(parse_in_worker).toHaveBeenCalledTimes(2)
  const last_signal = parse_in_worker.mock.calls.at(-1)?.[3]?.signal
  viewer.dispose()
  expect(last_signal?.aborted).toBe(true)
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
