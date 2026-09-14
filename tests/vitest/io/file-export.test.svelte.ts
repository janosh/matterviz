import { download } from '$lib/io/fetch'
import ExportDestination from '$lib/io/ExportDestination.svelte'
import { FileExportState } from '$lib/io/file-export.svelte'
import { mount, tick, unmount } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'

vi.mock(`$lib/io/fetch`, () => ({ download: vi.fn() }))

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  document.body.replaceChildren()
})

test(`filename follows the source until edited, rejects paths, and resets the destination`, async () => {
  let source = $state(`initial`)
  const export_state = new FileExportState(() => source)
  const pane = mount(ExportDestination, {
    target: document.body,
    props: { state: export_state },
  })
  await tick()
  const input = document.querySelector(`input`)
  if (!input) throw new Error(`Missing filename input`)
  expect(input.value).toBe(`initial`)
  source = `changed`
  await tick()
  expect(input.value).toBe(`changed`)
  input.value = `My movie`
  input.dispatchEvent(new Event(`input`, { bubbles: true }))
  await tick()
  await export_state.run(({ filename, save }) =>
    save(`contents`, `${filename}.csv`, `text/csv`),
  )
  expect(download).toHaveBeenCalledExactlyOnceWith(`contents`, `My movie.csv`, `text/csv`)
  expect(
    document.querySelector<HTMLButtonElement>(`[aria-label="Choose export folder"]`)?.disabled,
  ).toBe(true)
  const task = vi.fn()
  vi.spyOn(console, `error`).mockImplementation(() => {})
  for (const invalid of [``, `..`, `folder/file`, `folder\\file`, `bad\0name`]) {
    export_state.filename = invalid
    await export_state.run(task)
    expect(export_state.error).not.toBe(``)
  }
  expect(task).not.toHaveBeenCalled()
  await unmount(pane)
})

test.each([`success`, `exists`, `denied`, `write-error`, `cancel-write`] as const)(
  `selected folder handles %s without redirecting to browser downloads`,
  async (outcome) => {
    const error_spy = vi.spyOn(console, `error`).mockImplementation(() => {})
    const controller = new AbortController()
    const chunks: Uint8Array<ArrayBuffer>[] = []
    const close = vi.fn()
    const abort = vi.fn()
    const create_writable = vi.fn(
      async () =>
        new WritableStream<Uint8Array<ArrayBuffer>>({
          write(chunk) {
            chunks.push(chunk)
            if (outcome === `write-error`) throw new Error(`Disk full`)
            if (outcome === `cancel-write`) controller.abort(new Error(`Cancelled`))
          },
          close,
          abort,
        }),
    )
    const get_file = vi.fn(async (_name: string, options?: { create?: boolean }) => {
      if (outcome === `denied`)
        throw new DOMException(`Folder permission denied`, `NotAllowedError`)
      if (!options?.create && outcome !== `exists`)
        throw new DOMException(`Missing`, `NotFoundError`)
      return { createWritable: create_writable }
    })
    const directory = { name: `Movies`, getFileHandle: get_file }
    const picker = vi.fn().mockResolvedValue(directory)
    vi.stubGlobal(`showDirectoryPicker`, picker)
    const export_state = new FileExportState(() => `My movie`)
    const pane = mount(ExportDestination, {
      target: document.body,
      props: { state: export_state },
    })
    await tick()
    const choose = document.querySelector<HTMLButtonElement>(
      `[aria-label="Choose export folder"]`,
    )
    choose?.click()
    await vi.waitFor(() => expect(export_state.directory).toBe(directory))
    expect(picker).toHaveBeenCalledWith({
      id: `matterviz-export`,
      mode: `readwrite`,
      startIn: `downloads`,
    })
    expect(document.body.textContent).toContain(`Movies/`)
    // Cancelling a subsequent picker preserves the chosen folder and reports no error.
    picker.mockRejectedValueOnce(new DOMException(`Cancelled`, `AbortError`))
    choose?.click()
    await vi.waitFor(() => expect(picker).toHaveBeenCalledTimes(2))
    await tick()
    expect(export_state.directory).toBe(directory)
    expect(export_state.error).toBe(``)

    const encode = vi.fn(() => new Blob([`encoded video`], { type: `video/mp4` }))
    await export_state.run(async ({ filename, prepare }) => {
      const save = await prepare(`${filename}.mp4`, controller.signal)
      await save(encode(), `video/mp4`)
    })
    expect(download).not.toHaveBeenCalled()
    expect(export_state.busy).toBe(false)
    expect(encode).toHaveBeenCalledTimes([`exists`, `denied`].includes(outcome) ? 0 : 1)
    expect(close).toHaveBeenCalledTimes(outcome === `success` ? 1 : 0)
    if (outcome === `success`) {
      expect(await new Blob(chunks).text()).toBe(`encoded video`)
      expect(export_state.error).toBe(``)
      expect(get_file).toHaveBeenLastCalledWith(`My movie.mp4`, { create: true })
    } else {
      expect(export_state.error).toContain(
        {
          exists: `already exists`,
          denied: `permission denied`,
          'write-error': `Disk full`,
          'cancel-write': `Cancelled`,
        }[outcome],
      )
      expect(error_spy).toHaveBeenCalledOnce()
    }
    if (outcome === `cancel-write`) expect(abort).toHaveBeenCalledOnce()
    document.querySelector<HTMLButtonElement>(`[aria-label="Use browser downloads"]`)?.click()
    await tick()
    expect(export_state.directory).toBeNull()
    expect(document.body.textContent).toContain(`Browser downloads`)
    await unmount(pane)
  },
)
