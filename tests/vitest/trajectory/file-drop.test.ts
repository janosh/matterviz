// Regression: a single OS/IDE drag often carries BOTH a File and a text/plain
// payload (e.g. the file path). The text/plain fallback must not run after a
// file was successfully loaded, else it clobbers the trajectory with a parse error.
import type { TrajHandlerData } from '$lib/trajectory'
import Trajectory from '$lib/trajectory/Trajectory.svelte'
import { mount, unmount } from 'svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'

const MULTI_FRAME_XYZ = `2\nStep 1\nH 0.0 0.0 0.0\nH 0.0 0.0 0.74
2\nStep 2\nH 0.0 0.0 0.0\nH 0.0 0.0 0.78`

const create_drop_event = (files: File[], text_plain = ``): DragEvent => {
  const drag_event = new DragEvent(`drop`, { bubbles: true })
  const data_transfer = {
    files: Object.assign(files, { item: (idx: number) => files[idx] ?? null }) as FileList,
    getData: (type: string) => (type === `text/plain` ? text_plain : ``),
    dropEffect: `copy` as const,
    effectAllowed: `copy` as const,
    items: [] as unknown as DataTransferItemList,
    types: [] as readonly string[],
    clearData: () => {},
    setData: () => {},
    setDragImage: () => {},
  }
  Object.defineProperty(drag_event, `dataTransfer`, { value: data_transfer })
  return drag_event
}

const mounted: ReturnType<typeof mount>[] = []
afterEach(() => {
  for (const app of mounted.splice(0)) void unmount(app)
})

describe(`Trajectory file drop`, () => {
  test(`text/plain payload alongside a dropped file does not clobber the load`, async () => {
    let load_data: TrajHandlerData | undefined
    let error_data: TrajHandlerData | undefined
    mounted.push(
      mount(Trajectory, {
        target: document.body,
        props: {
          display_mode: `structure`,
          show_controls: `never`,
          on_file_load: (data: TrajHandlerData) => (load_data = data),
          on_error: (data: TrajHandlerData) => (error_data = data),
        },
      }),
    )

    const file = new File([MULTI_FRAME_XYZ], `test.xyz`, { type: `text/plain` })
    const viewer = document.querySelector(`.trajectory`) as HTMLElement
    // IDE/file-manager drags also set text/plain to the source path
    viewer.dispatchEvent(create_drop_event([file], `/home/user/test.xyz`))

    await vi.waitFor(() => expect(load_data).toBeDefined())
    expect(load_data?.frame_count).toBe(2)
    expect(load_data?.filename).toBe(`test.xyz`)
    expect(error_data).toBeUndefined()
  })
})
