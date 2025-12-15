// Tests for Fermi surface export functionality
import {
  export_scene,
  export_to_gltf,
  export_to_obj,
  export_to_stl,
} from '$lib/fermi-surface/export'
import type { Scene } from 'three'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Track exporter calls to verify scene is passed correctly
const stl_parse_spy = vi.fn()
const obj_parse_spy = vi.fn()
const gltf_parse_spy = vi.fn()

// Configurable mock behavior
let stl_return_dataview = true
let gltf_should_fail = false

vi.mock(`three/addons/exporters/STLExporter.js`, () => ({
  STLExporter: class {
    parse = stl_parse_spy
  },
}))

vi.mock(`three/addons/exporters/OBJExporter.js`, () => ({
  OBJExporter: class {
    parse = obj_parse_spy
  },
}))

vi.mock(`three/addons/exporters/GLTFExporter.js`, () => ({
  GLTFExporter: class {
    parse = gltf_parse_spy
  },
}))

// Capture blobs for content verification
let captured_blobs: Blob[] = []
const call_order: string[] = []
const mock_link = {
  href: ``,
  download: ``,
  click: vi.fn(() => call_order.push(`click`)),
}

beforeEach(() => {
  captured_blobs = []
  call_order.length = 0
  stl_return_dataview = true
  gltf_should_fail = false

  // Configure spy implementations
  stl_parse_spy.mockImplementation(() => {
    // Test both DataView and ArrayBuffer branches
    if (stl_return_dataview) {
      return new DataView(new ArrayBuffer(84)) // Minimum valid STL size
    }
    return new ArrayBuffer(84)
  })

  obj_parse_spy.mockImplementation(() => {
    return `# OBJ file\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n`
  })

  gltf_parse_spy.mockImplementation(
    (
      _scene: Scene,
      on_success: (gltf: object) => void,
      on_error: (err: Error) => void,
    ) => {
      setTimeout(() => {
        if (gltf_should_fail) {
          on_error(new Error(`GLTF export failed`))
        } else {
          on_success({ asset: { version: `2.0` }, scenes: [{}] })
        }
      }, 0)
    },
  )

  vi.stubGlobal(`URL`, {
    createObjectURL: vi.fn((blob: Blob) => {
      captured_blobs.push(blob)
      return `blob:mock-url-${captured_blobs.length}`
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
  mock_link.click.mockClear()
  stl_parse_spy.mockClear()
  obj_parse_spy.mockClear()
  gltf_parse_spy.mockClear()
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe(`export_scene`, () => {
  const mock_scene = { type: `Scene`, children: [`mesh1`] } as unknown as Scene

  it(`rejects unsupported format with descriptive error`, async () => {
    await expect(export_scene(mock_scene, `xyz` as `stl`, `test`)).rejects.toThrow(
      `Unsupported export format: xyz`,
    )
    // Verify no exporter was called
    expect(stl_parse_spy).not.toHaveBeenCalled()
    expect(obj_parse_spy).not.toHaveBeenCalled()
    expect(gltf_parse_spy).not.toHaveBeenCalled()
  })

  it.each(
    [
      [`stl`, stl_parse_spy, { binary: true }],
      [`obj`, obj_parse_spy, undefined],
      [`gltf`, gltf_parse_spy, { binary: false }],
    ] as const,
  )(
    `%s: passes scene to exporter with correct options`,
    async (format, spy, expected_options) => {
      await export_scene(mock_scene, format, `test-export`)

      expect(spy).toHaveBeenCalledOnce()
      // Verify the actual scene object was passed (not just any object)
      const call_args = spy.mock.calls[0]
      expect(call_args[0]).toBe(mock_scene)
      if (expected_options) {
        // STL: options is 2nd arg; GLTF: options is 4th arg
        const options_arg = format === `gltf` ? call_args[3] : call_args[1]
        expect(options_arg).toEqual(expected_options)
      }
    },
  )

  it.each(
    [
      [`stl`, `test.stl`, `application/octet-stream`],
      [`obj`, `test.obj`, `text/plain`],
      [`gltf`, `test.gltf`, `application/json`],
    ] as const,
  )(
    `%s: creates blob with correct MIME type and triggers download`,
    async (format, expected_filename, expected_mime) => {
      await export_scene(mock_scene, format, `test`)

      expect(captured_blobs).toHaveLength(1)
      expect(captured_blobs[0].type).toBe(expected_mime)
      expect(mock_link.download).toBe(expected_filename)
      expect(call_order).toEqual([`appendChild`, `click`, `removeChild`])
      expect(URL.revokeObjectURL).toHaveBeenCalledWith(`blob:mock-url-1`)
    },
  )
})

describe(`export_to_stl`, () => {
  const mock_scene = { type: `Scene` } as unknown as Scene

  it.each([
    [`DataView`, true],
    [`ArrayBuffer`, false],
  ])(`handles %s return type from exporter`, async (_, use_dataview) => {
    stl_return_dataview = use_dataview
    await export_to_stl(mock_scene, `fermi-surface`)

    expect(captured_blobs[0].type).toBe(`application/octet-stream`)
    expect(captured_blobs[0].size).toBe(84)
  })
})

describe(`export_to_obj`, () => {
  const mock_scene = { type: `Scene` } as unknown as Scene

  it(`creates text blob with valid OBJ structure`, async () => {
    await export_to_obj(mock_scene, `fermi-surface`)

    expect(captured_blobs[0].type).toBe(`text/plain`)
    const text = await captured_blobs[0].text()
    // Verify OBJ format structure
    expect(text).toMatch(/^# OBJ file/)
    expect(text).toMatch(/v \d+ \d+ \d+/) // vertex line
    expect(text).toMatch(/f \d+ \d+ \d+/) // face line
  })
})

describe(`export_to_gltf`, () => {
  const mock_scene = { type: `Scene` } as unknown as Scene

  it(`creates JSON blob with valid GLTF 2.0 structure`, async () => {
    await export_to_gltf(mock_scene, `fermi-surface`)

    expect(captured_blobs[0].type).toBe(`application/json`)
    const text = await captured_blobs[0].text()
    const parsed = JSON.parse(text)
    expect(parsed.asset.version).toBe(`2.0`)
    expect(parsed.scenes).toBeInstanceOf(Array)
  })

  it(`rejects when exporter calls error callback`, async () => {
    gltf_should_fail = true

    await expect(export_to_gltf(mock_scene, `test`)).rejects.toThrow(
      `GLTF export failed`,
    )
    // Verify no blob was created on error
    expect(captured_blobs).toHaveLength(0)
  })
})
