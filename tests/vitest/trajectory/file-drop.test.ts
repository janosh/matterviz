// Regression: a single OS/IDE drag often carries BOTH a File and a text/plain
// payload (e.g. the file path). The text/plain fallback must not run after a
// file was successfully loaded, else it clobbers the trajectory with a parse error.
import Trajectory from '$lib/trajectory/Trajectory.svelte'
import { mount, unmount, type ComponentProps } from 'svelte'
import { afterEach, expect, test, vi } from 'vitest'

const MULTI_FRAME_XYZ = `2\nStep 1\nH 0.0 0.0 0.0\nH 0.0 0.0 0.74
2\nStep 2\nH 0.0 0.0 0.0\nH 0.0 0.0 0.78`

const gzip = async (content: string): Promise<ArrayBuffer> => {
  const stream = new Blob([content]).stream().pipeThrough(new CompressionStream(`gzip`))
  return new Response(stream).arrayBuffer()
}

const create_drop_event = (files: File[], text_plain = ``): DragEvent => {
  const drag_event = new DragEvent(`drop`, { bubbles: true })
  Object.defineProperty(drag_event, `dataTransfer`, {
    value: {
      files,
      getData: (type: string) => (type === `text/plain` ? text_plain : ``),
    },
  })
  return drag_event
}

const mounted: ReturnType<typeof mount>[] = []
const drop_file = (
  file: File,
  handlers: Partial<Pick<ComponentProps<typeof Trajectory>, `on_file_load` | `on_error`>>,
  text_plain = ``,
): void => {
  mounted.push(
    mount(Trajectory, {
      target: document.body,
      props: { display_mode: `structure`, show_controls: `never`, ...handlers },
    }),
  )
  const viewer = document.querySelector<HTMLElement>(`.trajectory`)
  if (!viewer) throw new Error(`Trajectory root not found`)
  viewer.dispatchEvent(create_drop_event([file], text_plain))
}

afterEach(async () => {
  for (const app of mounted.splice(0)) await unmount(app)
})

test.each([`test.xyz`, `test.xyz.gz`])(
  `loads %s with stable source identity`,
  async (source_filename) => {
    const on_file_load = vi.fn()
    const on_error = vi.fn()
    const content = source_filename.endsWith(`.gz`)
      ? await gzip(MULTI_FRAME_XYZ)
      : MULTI_FRAME_XYZ
    const file = new File([content], source_filename)
    // IDE/file-manager drags also set text/plain to the source path
    drop_file(file, { on_file_load, on_error }, `/home/user/${source_filename}`)

    await vi.waitFor(() =>
      expect(on_file_load).toHaveBeenCalledWith(
        expect.objectContaining({
          frame_count: 2,
          filename: `test.xyz`,
          source_filename,
        }),
      ),
    )
    expect(on_error).not.toHaveBeenCalled()
  },
)

test(`reports corrupt compressed files with stable source identity`, async () => {
  const on_error = vi.fn()
  const file = new File([`not gzip data`], `broken.xyz.gz`)
  drop_file(file, { on_error })

  await vi.waitFor(() =>
    expect(on_error).toHaveBeenCalledWith({
      error_msg: expect.stringContaining(`Failed to load file:`),
      filename: file.name,
      source_filename: file.name,
      file_size: file.size,
    }),
  )
})
