import {
  convert_instanced_meshes_to_regular,
  export_scene_as,
  generate_mtl_content,
} from '$lib/scene'
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js'
import type { MeshPhongMaterial } from 'three/webgpu'
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedMesh,
  Mesh,
  MeshStandardMaterial,
  Scene,
  ShaderMaterial,
  SphereGeometry,
} from 'three/webgpu'
import { afterEach, beforeEach, describe, expect, it, test, vi } from 'vitest'

const stl_spy = vi.fn()
const obj_spy = vi.fn()
const gltf_spy = vi.fn()

vi.mock(`three/examples/jsm/exporters/STLExporter.js`, () => ({
  STLExporter: class {
    parse = stl_spy
  },
}))
vi.mock(`three/examples/jsm/exporters/OBJExporter.js`, () => ({
  OBJExporter: class {
    parse = obj_spy
  },
}))
vi.mock(`three/examples/jsm/exporters/GLTFExporter.js`, () => ({
  GLTFExporter: class {
    parse = gltf_spy
  },
}))

// export_scene_as hands the exporters a converted clone, so assert on structure, not identity
const exported_scene = (spy: ReturnType<typeof vi.fn>): Scene => spy.mock.calls[0][0]

describe(`export_scene_as`, () => {
  let downloads: { blob: Blob; filename: string }[] = []
  const mock_link = { href: ``, download: ``, click: vi.fn() }
  const scene = new Scene()
  const sphere = new Mesh(new SphereGeometry(1), new MeshStandardMaterial({ color: `red` }))
  sphere.material.name = `red_sphere`
  sphere.name = `sphere`
  scene.add(sphere)

  beforeEach(() => {
    downloads = []
    vi.useFakeTimers()
    stl_spy.mockReset().mockImplementation(() => new DataView(new ArrayBuffer(84)))
    obj_spy
      .mockReset()
      .mockImplementation(() => `# OBJ file\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n`)
    gltf_spy
      .mockReset()
      .mockImplementation((_scene: Scene, on_done: (result: ArrayBuffer) => void) =>
        on_done(new ArrayBuffer(12)),
      )
    vi.stubGlobal(`URL`, {
      createObjectURL: vi.fn((blob: Blob) => {
        downloads.push({ blob, filename: `` })
        return `blob:mock`
      }),
      revokeObjectURL: vi.fn(),
    })
    // download() clicks a detached anchor so document dismissal handlers never see it
    mock_link.click.mockImplementation(() => {
      downloads[downloads.length - 1].filename = mock_link.download
    })
    vi.spyOn(document, `createElement`).mockReturnValue(mock_link as never)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it(`rejects unsupported formats before touching any exporter`, async () => {
    await expect(export_scene_as(scene, `xyz` as `stl`, `test`)).rejects.toThrow(
      `Unsupported scene export format: xyz`,
    )
    for (const spy of [stl_spy, obj_spy, gltf_spy]) expect(spy).not.toHaveBeenCalled()
    expect(downloads).toHaveLength(0)
  })

  it.each([
    [`DataView`, () => new DataView(new ArrayBuffer(84))],
    [`ArrayBuffer`, () => new ArrayBuffer(84)],
  ] as const)(`stl: binary export (%s return) downloads test.stl`, async (_label, make) => {
    stl_spy.mockImplementation(make)
    await export_scene_as(scene, `stl`, `test`)
    expect(stl_spy).toHaveBeenCalledOnce()
    expect(stl_spy.mock.calls[0][1]).toEqual({ binary: true })
    expect(exported_scene(stl_spy).children[0].name).toBe(`sphere`)
    expect(downloads).toEqual([{ blob: expect.any(Blob), filename: `test.stl` }])
    expect(downloads[0].blob.type).toBe(`application/octet-stream`)
    expect(downloads[0].blob.size).toBe(84)
  })

  it(`obj: writes a mtllib-referenced OBJ, then the MTL with the scene's material colors`, async () => {
    await export_scene_as(scene, `obj`, `test`)
    expect(obj_spy).toHaveBeenCalledOnce()
    expect(downloads.map((item) => item.filename)).toEqual([`test.obj`])
    const obj_text = await downloads[0].blob.text()
    expect(obj_text).toMatch(/^mtllib test\.mtl\n# OBJ file/)
    expect(obj_text).toMatch(/f \d+ \d+ \d+/)
    // the companion MTL is delayed so browsers don't flag back-to-back downloads
    vi.advanceTimersByTime(100)
    expect(downloads.map((item) => item.filename)).toEqual([`test.obj`, `test.mtl`])
    const mtl_text = await downloads[1].blob.text()
    expect(mtl_text).toContain(`newmtl red_sphere`)
    expect(mtl_text).toContain(`Kd 1.000000 0.000000 0.000000`)
    expect(downloads.every((item) => item.blob.type === `text/plain`)).toBe(true)
  })

  it(`glb: binary glTF download`, async () => {
    await export_scene_as(scene, `glb`, `test`)
    expect(gltf_spy).toHaveBeenCalledOnce()
    expect(gltf_spy.mock.calls[0][3]).toEqual({ binary: true })
    expect(downloads).toEqual([{ blob: expect.any(Blob), filename: `test.glb` }])
    expect(downloads[0].blob.type).toBe(`model/gltf-binary`)
    expect(downloads[0].blob.size).toBe(12)
  })

  it.each([
    [
      `exporter error`,
      (_scene: Scene, _ok: unknown, on_error: (error: Error) => void) =>
        on_error(new Error(`GLTF export failed`)),
      `GLTF export failed`,
    ],
    [
      `non-binary result`,
      (_scene: Scene, on_done: (result: object) => void) => on_done({ asset: {} }),
      `GLB export returned object instead of ArrayBuffer`,
    ],
  ])(`glb: rejects on %s without downloading`, async (_label, parse_impl, message) => {
    gltf_spy.mockImplementation(parse_impl)
    await expect(export_scene_as(scene, `glb`, `test`)).rejects.toThrow(message)
    expect(downloads).toHaveLength(0)
  })

  it(`expands instanced meshes so the exporters see plain meshes`, async () => {
    const instanced_scene = new Scene()
    const atoms = new InstancedMesh(
      new SphereGeometry(0.5, 4, 4),
      new MeshStandardMaterial(),
      2,
    )
    atoms.name = `atoms`
    atoms.setColorAt(0, new Color(1, 0, 0))
    atoms.setColorAt(1, new Color(0, 0, 1))
    instanced_scene.add(atoms)
    await export_scene_as(instanced_scene, `glb`, `atoms`)
    const exported = exported_scene(gltf_spy)
    const instanced: string[] = []
    const plain_meshes: Mesh[] = []
    exported.traverse((obj) => {
      if (obj instanceof InstancedMesh) instanced.push(obj.name)
      else if (obj instanceof Mesh) plain_meshes.push(obj)
    })
    expect(instanced).toEqual([])
    expect(plain_meshes).toHaveLength(2)
    // one geometry clone shared by all instances (not one per atom), per-instance materials
    // only because the instance colours differ
    expect(plain_meshes[1].geometry).toBe(plain_meshes[0].geometry)
    expect(plain_meshes[0].geometry).not.toBe(atoms.geometry)
    expect(plain_meshes[1].material).not.toBe(plain_meshes[0].material)
    // the live scene keeps its InstancedMesh
    expect(instanced_scene.children[0]).toBe(atoms)
  })

  it(`shares one material across instances when no per-instance colour resolves`, () => {
    const instanced_scene = new Scene()
    const spheres = new InstancedMesh(
      new SphereGeometry(0.5, 4, 4),
      new MeshStandardMaterial({ color: new Color(0, 1, 0) }),
      3,
    )
    instanced_scene.add(spheres)
    const converted = convert_instanced_meshes_to_regular(instanced_scene)
    const meshes: Mesh[] = []
    converted.traverse((obj) => {
      if (obj instanceof Mesh) meshes.push(obj)
    })
    expect(meshes).toHaveLength(3)
    expect(new Set(meshes.map((mesh) => mesh.material)).size).toBe(1)
    expect(new Set(meshes.map((mesh) => mesh.geometry)).size).toBe(1)
    const material = meshes[0].material as MeshStandardMaterial
    expect([material.color.r, material.color.g, material.color.b]).toEqual([0, 1, 0])
  })
})

// Tests for 3D export color preservation (Issue #203)
describe(`3D Export Color Preservation`, () => {
  describe(`convert_instanced_meshes_to_regular color precedence`, () => {
    // Colors below use component form (already in working color space) so values
    // round-trip exactly through instanceColor buffers and material colors
    const converted_group_colors = (scene: Scene, name: string): number[][] => {
      const converted = convert_instanced_meshes_to_regular(scene)
      const colors: number[][] = []
      converted.traverse((obj) => {
        if (obj.name === name) {
          for (const child of obj.children) {
            const mat = (child as Mesh).material as MeshStandardMaterial
            colors.push([mat.color.r, mat.color.g, mat.color.b])
          }
        }
      })
      return colors
    }

    test(`reads per-instance colors instead of the white base material`, () => {
      // Mirrors InstancedAtoms/ArrowInstances: white material + instanceColor buffer
      const scene = new Scene()
      const atoms = new InstancedMesh(
        new SphereGeometry(0.5, 4, 4),
        new MeshStandardMaterial(),
        2,
      )
      atoms.name = `atoms`
      atoms.setColorAt(0, new Color(1, 0, 0))
      atoms.setColorAt(1, new Color(0, 0, 1))
      scene.add(atoms)

      expect(converted_group_colors(scene, `atoms`)).toEqual([
        [1, 0, 0],
        [0, 0, 1],
      ])
    })

    test(`keeps the material color when every instance color is white`, () => {
      // Mirrors material-colored instancing (for example ScatterPlot3D): Three creates an
      // all-white instanceColor buffer that multiplies, rather than replaces, material.color.
      const scene = new Scene()
      const material_colored = new InstancedMesh(
        new SphereGeometry(0.5, 4, 4),
        new MeshStandardMaterial({ color: new Color(0, 1, 0) }),
        1,
      )
      material_colored.name = `material-colored`
      material_colored.setColorAt(0, new Color(1, 1, 1))
      scene.add(material_colored)

      expect(converted_group_colors(scene, `material-colored`)).toEqual([[0, 1, 0]])
    })

    // Gradient bonds carry two colors per instance in geometry attributes; the export takes
    // their per-channel midpoint and ignores both the shader material and instanceColor
    test(`shader-material bond gradients win over instance colors, per instance`, () => {
      const scene = new Scene()
      const bond_geometry = new SphereGeometry(0.5, 4, 4)
      bond_geometry.setAttribute(
        `instanceColorStart`,
        new InstancedBufferAttribute(new Float32Array([1, 0, 0, 0.2, 0.4, 0.6, 0, 0, 1]), 3),
      )
      bond_geometry.setAttribute(
        `instanceColorEnd`,
        new InstancedBufferAttribute(new Float32Array([0, 0, 1, 0.8, 0.2, 0.4, 0, 1, 0]), 3),
      )
      const bonds = new InstancedMesh(
        bond_geometry,
        new ShaderMaterial({ vertexShader: ``, fragmentShader: `` }),
        3,
      )
      bonds.name = `bonds`
      for (let idx = 0; idx < 3; idx++) bonds.setColorAt(idx, new Color(0, 1, 0))
      scene.add(bonds)

      const colors = converted_group_colors(scene, `bonds`)
      expect(colors).toHaveLength(3)
      for (const [idx, expected] of [
        [0.5, 0, 0.5],
        [0.5, 0.3, 0.5],
        [0, 0.5, 0.5],
      ].entries()) {
        for (const channel of [0, 1, 2])
          expect(colors[idx][channel]).toBeCloseTo(expected[channel], 5)
      }
    })

    // Per-instance and non-standard color attributes break GLTF accessor-count validation,
    // so the clone is stripped of them while the standard `position`/`color` stay and the
    // live scene's geometry is untouched
    test(`cleans cloned geometry without mutating the live scene`, () => {
      const scene = new Scene()
      const geometry = new BufferGeometry()
      for (const attr of [
        `instanceColorStart`,
        `instanceColorEnd`,
        `customColor`,
        `position`,
        `color`,
      ]) {
        geometry.setAttribute(attr, new Float32BufferAttribute([1, 0, 0], 3))
      }
      scene.add(new Mesh(geometry, new MeshStandardMaterial()))

      const converted = convert_instanced_meshes_to_regular(scene)
      const converted_mesh = converted.children[0]
      if (!(converted_mesh instanceof Mesh)) throw new Error(`Expected a converted mesh`)
      expect(converted_mesh.geometry).not.toBe(geometry)
      const kept = [
        `instanceColorStart`,
        `instanceColorEnd`,
        `customColor`,
        `position`,
        `color`,
      ].filter((attr) => converted_mesh.geometry.hasAttribute(attr))
      expect(kept).toEqual([`position`, `color`])
      expect(geometry.hasAttribute(`instanceColorStart`)).toBe(true)
    })
  })

  describe(`generate_mtl_content`, () => {
    test(`header and empty scene`, () => {
      const mtl = generate_mtl_content(new Scene())
      expect(mtl).toContain(`# MTL file generated by MatterViz`)
      expect(mtl).not.toContain(`newmtl`)
    })

    // Kd is written in sRGB, so the endpoints pass through but mid-tones do not: 0.5 working
    // (linear) is 0.735361 sRGB. Emitting the linear value instead reads back ~2x too dark.
    // Ka is 20% of the diffuse in LINEAR light, then encoded — scaling the encoded value
    // instead would decode to ~4% and leave the ambient term far too dark.
    const rgb_cases = [
      {
        name: `red`,
        rgb: [1, 0, 0],
        kd: `1.000000 0.000000 0.000000`,
        ka: `0.484535 0.000000 0.000000`,
      },
      {
        name: `green`,
        rgb: [0, 1, 0],
        kd: `0.000000 1.000000 0.000000`,
        ka: `0.000000 0.484535 0.000000`,
      },
      {
        name: `blue`,
        rgb: [0, 0, 1],
        kd: `0.000000 0.000000 1.000000`,
        ka: `0.000000 0.000000 0.484535`,
      },
      {
        name: `purple`,
        rgb: [0.5, 0, 0.5],
        kd: `0.735361 0.000000 0.735361`,
        ka: `0.349196 0.000000 0.349196`,
      },
    ]

    const mtl_for_color = (rgb: number[], name = `test`): string => {
      const scene = new Scene()
      const mat = new MeshStandardMaterial({ color: new Color(...rgb) })
      mat.name = name
      scene.add(new Mesh(new SphereGeometry(1), mat))
      return generate_mtl_content(scene)
    }

    // Ka is string-only (MTLLoader ignores it). Kd must also round-trip through MTLLoader,
    // which treats it as sRGB — writing linear values reads back ~2x too dark.
    test.each(rgb_cases)(`$name Kd/Ka strings and MTLLoader round-trip`, ({ rgb, kd, ka }) => {
      const mtl = mtl_for_color(rgb)
      expect(mtl).toContain(`Kd ${kd}`)
      expect(mtl).toContain(`Ka ${ka}`)
      const { color } = new MTLLoader().parse(mtl, ``).create(`test`) as MeshPhongMaterial
      for (const [idx, channel] of [color.r, color.g, color.b].entries()) {
        // six-decimal sRGB quantization → ~1e-5 linear; linear-write error is ~0.29
        expect(channel, `channel ${idx}`).toBeCloseTo(rgb[idx], 4)
      }
    })

    test(`material properties and deduplication`, () => {
      const scene = new Scene()
      const geom = new SphereGeometry(1)

      // Add two meshes with same material name
      const mat1 = new MeshStandardMaterial({ color: new Color(1, 0, 0), opacity: 0.5 })
      mat1.name = `shared`
      scene.add(new Mesh(geom, mat1))
      const mat2 = new MeshStandardMaterial({ color: new Color(0, 1, 0) })
      mat2.name = `shared`
      scene.add(new Mesh(geom, mat2))

      // the first material of a name wins and is written as one complete block: sRGB diffuse
      // and ambient, fixed specular term and exponent, its opacity as d, highlight shading
      const mtl = generate_mtl_content(scene)
      expect(mtl.match(/newmtl /g)).toHaveLength(1)
      expect(mtl).toContain(
        [
          `newmtl shared`,
          `Kd 1.000000 0.000000 0.000000`,
          `Ka 0.484535 0.000000 0.000000`,
          `Ks 0.500000 0.500000 0.500000`,
          `Ns 96.078431`,
          `d 0.500000`,
          `illum 2`,
        ].join(`\n`),
      )
      expect(mtl).not.toContain(`Kd 0.000000 1.000000 0.000000`)
    })

    // unnamed materials and materials without a color (ShaderMaterial) both fall back
    test.each([
      [`unnamed MeshStandardMaterial`, () => new MeshStandardMaterial()],
      [`ShaderMaterial`, () => new ShaderMaterial({ vertexShader: ``, fragmentShader: `` })],
    ])(`default name and white color for %s`, (_label, make_material) => {
      const scene = new Scene()
      scene.add(new Mesh(new SphereGeometry(1), make_material()))
      const mtl = generate_mtl_content(scene)
      expect(mtl).toContain(`newmtl default_material`)
      // white default takes the same linear-then-encode path as a real color
      expect(mtl).toContain(`Kd 1.000000 1.000000 1.000000`)
      expect(mtl).toContain(`Ka 0.484535 0.484535 0.484535`)
    })
  })
})
