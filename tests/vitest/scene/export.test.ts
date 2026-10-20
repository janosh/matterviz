import { AtomInstances } from '#lib/structure/atom-instances.js'
import { ArrowMesh } from '#lib/structure/arrow-mesh.js'
import { BondMesh } from '#lib/structure/bond-mesh.js'
import { prepare_bond_placements } from '#lib/structure/bond-rendering.js'
import {
  convert_instanced_meshes_to_regular,
  export_scene_as,
  generate_mtl_content,
} from '#lib/scene/export.js'
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js'
import type {
  Material,
  MeshPhongMaterial,
  MeshStandardMaterialParameters,
  Object3D,
} from 'three/webgpu'
import {
  BufferGeometry,
  Color,
  ConeGeometry,
  DoubleSide,
  Float32BufferAttribute,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
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
    parseAsync = gltf_spy
  },
}))

// export_scene_as hands the exporters a converted clone, so assert on structure, not identity
const exported_scene = (spy: ReturnType<typeof vi.fn>): Scene => spy.mock.calls[0][0]
const collect_meshes = (root: Object3D): Mesh[] => {
  const meshes: Mesh[] = []
  root.traverse((obj) => {
    if (obj instanceof Mesh) meshes.push(obj)
  })
  return meshes
}

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
    gltf_spy.mockReset().mockResolvedValue(new ArrayBuffer(12))
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

  const blob_types = { stl: `application/octet-stream`, glb: `model/gltf-binary` }
  it.each([
    [`stl`, `DataView`, () => new DataView(new ArrayBuffer(84)), 84],
    [`stl`, `ArrayBuffer`, () => new ArrayBuffer(84), 84],
    [`glb`, `ArrayBuffer`, async () => new ArrayBuffer(12), 12],
  ] as const)(`%s export of a %s downloads one file`, async (format, _label, make, size) => {
    const spy = format === `stl` ? stl_spy : gltf_spy
    spy.mockImplementation(make)
    await export_scene_as(scene, format, `test`)
    expect(spy).toHaveBeenCalledOnce()
    expect(spy.mock.calls[0][1]).toEqual({ binary: true })
    expect(exported_scene(spy).children[0].name).toBe(`sphere`)
    expect(downloads).toEqual([{ blob: expect.any(Blob), filename: `test.${format}` }])
    expect(downloads[0].blob.type).toBe(blob_types[format])
    expect(downloads[0].blob.size).toBe(size)
  })

  it(`obj: writes a mtllib-referenced OBJ, then the MTL with the scene's material colors`, async () => {
    const exporting = export_scene_as(scene, `obj`, `test`)
    await vi.advanceTimersByTimeAsync(0)
    expect(obj_spy).toHaveBeenCalledOnce()
    expect(downloads.map((item) => item.filename)).toEqual([`test.obj`])
    const obj_text = await downloads[0].blob.text()
    expect(obj_text).toMatch(/^mtllib test\.mtl\n# OBJ file/)
    expect(obj_text).toMatch(/f \d+ \d+ \d+/)
    // the companion MTL is delayed so browsers don't flag back-to-back downloads
    await vi.advanceTimersByTimeAsync(100)
    await exporting
    expect(downloads.map((item) => item.filename)).toEqual([`test.obj`, `test.mtl`])
    const mtl_text = await downloads[1].blob.text()
    expect(mtl_text).toContain(`newmtl red_sphere`)
    expect(mtl_text).toContain(`Kd 1.000000 0.000000 0.000000`)
    expect(downloads.every((item) => item.blob.type === `text/plain`)).toBe(true)
  })

  it.each([
    [`exporter error`, new Error(`GLTF export failed`), `GLTF export failed`],
    [`non-Error failure`, `encoder failed`, `encoder failed`],
    [`non-binary result`, { asset: {} }, `GLB export returned object instead of ArrayBuffer`],
  ] as const)(`glb: rejects on %s without downloading`, async (label, result, message) => {
    if (label === `non-binary result`) gltf_spy.mockResolvedValue(result)
    else gltf_spy.mockRejectedValue(result)
    await expect(export_scene_as(scene, `glb`, `test`)).rejects.toThrow(message)
    expect(downloads).toHaveLength(0)
  })

  it(`expands instanced meshes so the exporters see plain meshes and drops depth-only ones`, async () => {
    const instanced_scene = new Scene()
    // a translucent Fermi sheet's depth pre-pass draws no colour, so it is not exported
    const depth_pass = new Mesh(new SphereGeometry(1, 4, 4), new MeshBasicMaterial())
    depth_pass.material.colorWrite = false
    instanced_scene.add(depth_pass)
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
    const plain_meshes = collect_meshes(exported_scene(gltf_spy))
    expect(plain_meshes.filter((mesh) => mesh instanceof InstancedMesh)).toEqual([])
    expect(plain_meshes).toHaveLength(2)
    // one geometry clone shared by all instances (not one per atom), per-instance materials
    // only because the instance colours differ
    expect(plain_meshes[1].geometry).toBe(plain_meshes[0].geometry)
    expect(plain_meshes[0].geometry).not.toBe(atoms.geometry)
    expect(plain_meshes[1].material).not.toBe(plain_meshes[0].material)
    // per-instance colors are read instead of the white base material
    const colors = plain_meshes.map(({ material }) => {
      const { r, g, b } = (material as MeshStandardMaterial).color
      return [r, g, b]
    })
    expect(colors).toEqual([
      [1, 0, 0],
      [0, 0, 1],
    ])
    // the live scene keeps its InstancedMesh and depth pass
    const [kept_depth_pass, kept_atoms] = instanced_scene.children
    expect(kept_depth_pass).toBe(depth_pass)
    expect(kept_atoms).toBe(atoms)
  })

  // with all-white instance colors (as Three creates for material-colored instancing like
  // ScatterPlot3D) the instanceColor multiplies rather than replaces material.color
  it.each([false, true])(
    `shares one material for identical colors (instance colors: %s)`,
    (instance_colors) => {
      const instanced_scene = new Scene()
      const spheres = new InstancedMesh(
        new SphereGeometry(0.5, 4, 4),
        new MeshStandardMaterial({ color: new Color(0, 1, 0), side: DoubleSide }),
        3,
      )
      if (instance_colors)
        for (let idx = 0; idx < 3; idx++) spheres.setColorAt(idx, new Color(1, 1, 1))
      instanced_scene.add(spheres)
      const meshes = collect_meshes(convert_instanced_meshes_to_regular(instanced_scene))
      expect(meshes).toHaveLength(3)
      expect(new Set(meshes.map((mesh) => mesh.material)).size).toBe(1)
      expect(new Set(meshes.map((mesh) => mesh.geometry)).size).toBe(1)
      const material = meshes[0].material as MeshStandardMaterial
      expect([material.color.r, material.color.g, material.color.b]).toEqual([0, 1, 0])
      expect(material.side).toBe(DoubleSide)
    },
  )
})

// Tests for 3D export color preservation (Issue #203)
describe(`3D Export Color Preservation`, () => {
  describe(`convert_instanced_meshes_to_regular color precedence`, () => {
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

    // Gradient bonds carry two colors per instance in geometry attributes; the export takes
    // their per-channel midpoint and ignores both the shader material and instanceColor
    test.each([false, true])(
      `shader-material bond gradients win over instance colors (compact: %s)`,
      (compact) => {
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
        const bonds = new (compact ? BondMesh : InstancedMesh)(
          bond_geometry,
          new ShaderMaterial({ vertexShader: ``, fragmentShader: `` }),
          3,
        )
        bonds.name = `bonds`
        if (bonds instanceof BondMesh) {
          bonds.colors_start.array.set(bond_geometry.getAttribute(`instanceColorStart`).array)
          bonds.colors_end.array.set(bond_geometry.getAttribute(`instanceColorEnd`).array)
          bonds.thickness = 0.1
          bonds.update(
            prepare_bond_placements(
              [0, 1, 2].map((idx) => ({
                pos_1: [idx, 0, 0],
                pos_2: [idx, 1, 0],
                site_idx_1: idx,
                site_idx_2: idx + 1,
                bond_length: 1,
              })),
            ),
          )
        } else for (let idx = 0; idx < 3; idx++) bonds.setColorAt(idx, new Color(0, 1, 0))
        scene.add(bonds)

        const expected = [0.5, 0, 0.5, 0.5, 0.3, 0.5, 0, 0.5, 0.5]
        expect(converted_group_colors(scene, `bonds`).flat()).toEqual(
          expected.map((channel) => expect.closeTo(channel, 5)),
        )
      },
    )

    // Per-instance and non-standard color attributes break GLTF accessor-count validation,
    // so the clone is stripped of them while the standard `position`/`color` stay and the
    // live scene's geometry is untouched
    test(`cleans cloned geometry without mutating the live scene`, () => {
      const scene = new Scene()
      const geometry = new BufferGeometry()
      const standard = [`position`, `color`]
      const names = [`instanceColorStart`, `instanceColorEnd`, `customColor`, ...standard]
      for (const name of names)
        geometry.setAttribute(name, new Float32BufferAttribute([1, 0, 0], 3))
      scene.add(new Mesh(geometry, new MeshStandardMaterial()))

      const converted = convert_instanced_meshes_to_regular(scene)
      const converted_mesh = converted.children[0]
      if (!(converted_mesh instanceof Mesh)) throw new Error(`Expected a converted mesh`)
      expect(converted_mesh.geometry).not.toBe(geometry)
      const kept = names.filter((name) => converted_mesh.geometry.hasAttribute(name))
      expect(kept).toEqual(standard)
      expect(geometry.hasAttribute(`instanceColorStart`)).toBe(true)
    })
  })

  describe(`generate_mtl_content`, () => {
    test(`header and empty scene`, () => {
      const mtl = generate_mtl_content(new Scene())
      expect(mtl).toContain(`# MTL file generated by MatterViz`)
      expect(mtl).not.toContain(`newmtl`)
    })

    const mtl_for = (...materials: Material[]): string =>
      generate_mtl_content(
        new Scene().add(...materials.map((mat) => new Mesh(new SphereGeometry(1), mat))),
      )
    const named = (name: string, params: MeshStandardMaterialParameters) =>
      Object.assign(new MeshStandardMaterial(params), { name })

    // Kd is written in sRGB, so the endpoints pass through but mid-tones do not: 0.5 working
    // (linear) is 0.735361 sRGB. Emitting the linear value instead reads back ~2x too dark.
    // Ka is 20% of the diffuse in LINEAR light, then encoded — scaling the encoded value
    // instead would decode to ~4% and leave the ambient term far too dark. Ka is string-only
    // (MTLLoader ignores it); Kd must also round-trip through MTLLoader, which reads sRGB.
    test.each([
      [`red`, [1, 0, 0], `1.000000 0.000000 0.000000`, `0.484535 0.000000 0.000000`],
      [`green`, [0, 1, 0], `0.000000 1.000000 0.000000`, `0.000000 0.484535 0.000000`],
      [`blue`, [0, 0, 1], `0.000000 0.000000 1.000000`, `0.000000 0.000000 0.484535`],
      [`purple`, [0.5, 0, 0.5], `0.735361 0.000000 0.735361`, `0.349196 0.000000 0.349196`],
    ] as const)(
      `%s Kd/Ka strings and MTLLoader round-trip`,
      (_name, rgb, diffuse_color, ambient_color) => {
        const mtl = mtl_for(named(`test`, { color: new Color().fromArray(rgb) }))
        expect(mtl).toContain(`Kd ${diffuse_color}`)
        expect(mtl).toContain(`Ka ${ambient_color}`)
        const { color } = new MTLLoader().parse(mtl, ``).create(`test`) as MeshPhongMaterial
        for (const [idx, channel] of [color.r, color.g, color.b].entries()) {
          // six-decimal sRGB quantization → ~1e-5 linear; linear-write error is ~0.29
          expect(channel, `channel ${idx}`).toBeCloseTo(rgb[idx], 4)
        }
      },
    )

    test(`material properties and deduplication`, () => {
      const mtl = mtl_for(
        named(`shared`, { color: new Color(1, 0, 0), opacity: 0.5 }),
        named(`shared`, { color: new Color(0, 1, 0) }),
      )
      // the first material of a name wins and is written as one complete block: sRGB diffuse
      // and ambient, fixed specular term and exponent, its opacity as d, highlight shading
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
      const mtl = mtl_for(make_material())
      expect(mtl).toContain(`newmtl default_material`)
      // white default takes the same linear-then-encode path as a real color
      expect(mtl).toContain(`Kd 1.000000 1.000000 1.000000`)
      expect(mtl).toContain(`Ka 0.484535 0.484535 0.484535`)
    })
  })
})

// Export captures uploaded placements and colors, even as playback advances.
test.each([`atoms`, `arrows`])(
  `packed %s export captured transforms and colors without instance attributes`,
  (kind) => {
    const atoms =
      kind === `atoms`
        ? new AtomInstances(new SphereGeometry(0.5, 8, 8), new MeshStandardMaterial(), 3)
        : new ArrowMesh(new ConeGeometry(1, 1, 12), new MeshStandardMaterial(), 3)
    const positions = [
      [1.25, 2.5, -3.75],
      [1e8 + 0.1, -2e8, 3e8],
      [-2, 0, 1],
    ] as [number, number, number][]
    if (atoms instanceof AtomInstances)
      atoms.update_atoms(
        positions.map((position, idx) => ({ position, radius: [0.7, -2, 0][idx] })),
      )
    else {
      for (const [idx, position] of positions.entries()) {
        atoms.origins.array.set(position, idx * 3)
        atoms.lengths.setX(idx, idx)
        atoms.rotations.setXYZW(idx, 0, Math.SQRT1_2, 0, Math.SQRT1_2)
      }
      atoms.part = 1
      atoms.dimensions = [0.1, -0.2, -0.3]
      atoms.count = 3
      atoms.geometry.instanceCount = 3
    }
    // Identical colors share a material; nearby float colors must not be quantized together.
    atoms.colors.array.set([0.2, 0.3, 0.4, 0.2000001, 0.3, 0.4, 0.2, 0.3, 0.4])
    atoms.position.set(3, -1, 2)
    atoms.updateMatrixWorld(true)
    const scene = new Scene().add(atoms)
    const captured = convert_instanced_meshes_to_regular(scene)
    const meshes = captured.children[0].children as Mesh[]
    expect(meshes).toHaveLength(3)
    expect(meshes[0].material).toBe(meshes[2].material)
    expect(meshes[0].material).not.toBe(meshes[1].material)
    const local = new Matrix4()
    for (let idx = 0; idx < 3; idx++) {
      atoms.getMatrixAt(idx, local)
      expect(meshes[idx].matrix.elements).toEqual(
        new Matrix4().multiplyMatrices(atoms.matrix, local).elements,
      )
      expect(Object.keys(meshes[idx].geometry.attributes).toSorted()).toEqual([
        `normal`,
        `position`,
        `uv`,
      ])
      expect(meshes[idx].geometry.type).toBe(`BufferGeometry`)
      expect(meshes[idx].material).toMatchObject({
        color: new Color().fromBufferAttribute(atoms.colors, idx),
      })
    }
    const captured_matrix = meshes[0].matrix.clone()
    if (atoms instanceof AtomInstances)
      atoms.update_atoms([{ position: [9, 8, 7], radius: 2 }])
    else atoms.origins.setXYZ(0, 9, 8, 7)
    expect(meshes[0].matrix).toEqual(captured_matrix)
    expect(
      atoms.geometry.getAttribute(
        atoms instanceof AtomInstances ? `atomPositionRadius` : `arrowOrigin`,
      ),
    ).toBe(atoms instanceof AtomInstances ? atoms.positions : atoms.origins)
    atoms.dispose()
  },
)
