// Tests for Fermi surface export functionality
import { export_scene, export_to_gltf, export_to_stl } from '$lib/fermi-surface/export'
import type { Scene } from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const stl_spy = vi.fn()
const obj_spy = vi.fn()
const gltf_spy = vi.fn()
let stl_return_dataview = true
let gltf_should_fail = false

vi.mock(`three/addons/exporters/STLExporter.js`, () => ({
  STLExporter: class {
    parse = stl_spy
  },
}))
vi.mock(`three/addons/exporters/OBJExporter.js`, () => ({
  OBJExporter: class {
    parse = obj_spy
  },
}))
vi.mock(`three/addons/exporters/GLTFExporter.js`, () => ({
  GLTFExporter: class {
    parse = gltf_spy
  },
}))

let captured_blobs: Blob[] = []
const call_order: string[] = []
const mock_link = { href: ``, download: ``, click: vi.fn(() => call_order.push(`click`)) }
const mock_scene = { type: `Scene`, children: [`mesh1`] } as unknown as Scene

beforeEach(() => {
  captured_blobs = []
  call_order.length = 0
  stl_return_dataview = true
  gltf_should_fail = false

  stl_spy.mockImplementation(() =>
    stl_return_dataview ? new DataView(new ArrayBuffer(84)) : new ArrayBuffer(84)
  )
  obj_spy.mockImplementation(() => `# OBJ file\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n`)
  gltf_spy.mockImplementation(
    (_: Scene, ok: (g: object) => void, err: (e: Error) => void) => {
      setTimeout(
        () =>
          gltf_should_fail
            ? err(new Error(`GLTF export failed`))
            : ok({ asset: { version: `2.0` }, scenes: [{}] }),
        0,
      )
    },
  )

  vi.stubGlobal(`URL`, {
    createObjectURL: vi.fn((blob: Blob) => {
      captured_blobs.push(blob)
      return `blob:mock`
    }),
    revokeObjectURL: vi.fn(),
  })
  vi.spyOn(document, `createElement`).mockReturnValue(mock_link as never)
  vi.spyOn(document.body, `appendChild`).mockImplementation(() => {
    call_order.push(`appendChild`)
    return mock_link as never
  })
  vi.spyOn(document.body, `removeChild`).mockImplementation(() => {
    call_order.push(`removeChild`)
    return mock_link as never
  })
  mock_link.href = ``
  mock_link.download = ``
  ;[stl_spy, obj_spy, gltf_spy, mock_link.click].forEach((spy) => spy.mockClear())
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe(`export_scene`, () => {
  it(`rejects unsupported format`, async () => {
    await expect(export_scene(mock_scene, `xyz` as `stl`, `test`)).rejects.toThrow(
      `Unsupported export format: xyz`,
    )
    expect(stl_spy).not.toHaveBeenCalled()
    expect(obj_spy).not.toHaveBeenCalled()
    expect(gltf_spy).not.toHaveBeenCalled()
  })

  it.each(
    [
      [`stl`, `test.stl`, `application/octet-stream`, stl_spy, { binary: true }, 1],
      [`obj`, `test.obj`, `text/plain`, obj_spy, undefined, 1],
      [`gltf`, `test.gltf`, `application/json`, gltf_spy, { binary: false }, 3],
    ] as const,
  )(`%s: correct exporter options, MIME type, and download flow`, async (
    format,
    filename,
    mime,
    spy,
    options,
    options_idx,
  ) => {
    await export_scene(mock_scene, format, `test`)

    // Verify exporter called with scene and options
    expect(spy).toHaveBeenCalledOnce()
    expect(spy.mock.calls[0][0]).toBe(mock_scene)
    if (options) expect(spy.mock.calls[0][options_idx]).toEqual(options)

    // Verify blob and download
    expect(captured_blobs[0].type).toBe(mime)
    expect(mock_link.download).toBe(filename)
    expect(call_order).toEqual([`appendChild`, `click`, `removeChild`])
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(`blob:mock`)
  })
})

describe(`format-specific edge cases`, () => {
  it.each([[`DataView`, true], [`ArrayBuffer`, false]] as const)(
    `STL handles %s return type`,
    async (_, use_dataview) => {
      stl_return_dataview = use_dataview
      await export_to_stl(mock_scene, `test`)
      expect(captured_blobs[0].size).toBe(84)
      expect(captured_blobs[0].type).toBe(`application/octet-stream`)
    },
  )

  it(`OBJ creates valid text structure`, async () => {
    await export_scene(mock_scene, `obj`, `test`)
    const text = await captured_blobs[0].text()
    expect(text).toMatch(/^# OBJ file/)
    expect(text).toMatch(/v \d+ \d+ \d+/)
    expect(text).toMatch(/f \d+ \d+ \d+/)
  })

  it(`GLTF creates valid JSON structure`, async () => {
    await export_to_gltf(mock_scene, `test`)
    const parsed = JSON.parse(await captured_blobs[0].text())
    expect(parsed.asset.version).toBe(`2.0`)
    expect(parsed.scenes).toBeInstanceOf(Array)
  })

  it(`GLTF rejects on exporter error`, async () => {
    gltf_should_fail = true
    await expect(export_to_gltf(mock_scene, `test`)).rejects.toThrow(`GLTF export failed`)
    expect(captured_blobs).toHaveLength(0)
  })
})
