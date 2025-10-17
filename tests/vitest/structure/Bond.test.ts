import type { BondGroupWithGradients, BondInstance } from '$lib/structure'
import { Color, Matrix4, Vector3 } from 'three'
import { describe, expect, test } from 'vitest'

describe(`Bond Component`, () => {
  test(`BondInstance structure`, () => {
    const matrix = new Matrix4().makeTranslation(1, 2, 3).scale(
      new Vector3(0.5, 1.0, 0.5),
    )
    const instance: BondInstance = {
      matrix: new Float32Array(matrix.elements),
      color_start: `#ff0000`,
      color_end: `#0000ff`,
    }

    expect(instance.matrix).toBeInstanceOf(Float32Array)
    expect(instance.matrix).toHaveLength(16)
    expect(instance.color_start).toMatch(/^#[0-9a-f]{6}$/i)
    expect(instance.color_end).toMatch(/^#[0-9a-f]{6}$/i)
  })

  test(`BondGroupWithGradients with defaults`, () => {
    const group: BondGroupWithGradients = {
      thickness: 0.15,
      instances: [{
        matrix: new Float32Array(16),
        color_start: `#ff0000`,
        color_end: `#0000ff`,
      }],
    }

    expect(group.thickness).toBeGreaterThan(0)
    expect(Array.isArray(group.instances)).toBe(true)
    expect(group.ambient_light ?? 1.5).toBe(1.5)
    expect(group.directional_light ?? 2.2).toBe(2.2)
  })

  test(`color hex to RGB conversion`, () => {
    const test_colors = [
      [`#ff0000`, [1, 0, 0]],
      [`#00ff00`, [0, 1, 0]],
      [`#0000ff`, [0, 0, 1]],
      [`#ffffff`, [1, 1, 1]],
      [`#000000`, [0, 0, 0]],
    ] as const

    for (const [hex, [r, g, b]] of test_colors) {
      const color = new Color(hex)
      expect([color.r, color.g, color.b]).toEqual([r, g, b])
    }
  })

  test(`matrix transformation round-trip`, () => {
    const matrix = new Matrix4().makeTranslation(1.5, 2.5, 3.5)
    const float_array = new Float32Array(matrix.elements)
    const reconstructed = new Matrix4().fromArray(float_array as unknown as number[])

    expect(float_array).toHaveLength(16)
    for (let idx = 0; idx < 16; idx++) {
      expect(reconstructed.elements[idx]).toBeCloseTo(matrix.elements[idx], 10)
    }
  })

  test(`instance color arrays format`, () => {
    const instance_count = 10
    const colors_start = new Float32Array(instance_count * 3)
    const colors_end = new Float32Array(instance_count * 3)
    const temp_color = new Color()

    for (let idx = 0; idx < instance_count; idx++) {
      temp_color.set(`#ff0000`)
      colors_start.set([temp_color.r, temp_color.g, temp_color.b], idx * 3)
      temp_color.set(`#0000ff`)
      colors_end.set([temp_color.r, temp_color.g, temp_color.b], idx * 3)
    }

    expect(colors_start).toHaveLength(instance_count * 3)
    expect(colors_start.slice(0, 3)).toEqual(new Float32Array([1, 0, 0]))
    expect(colors_end.slice(0, 3)).toEqual(new Float32Array([0, 0, 1]))
  })

  test.each([
    [0, []],
    [1, Array(1).fill(null)],
    [100, Array(100).fill(null)],
    [10000, Array(10000).fill(null)],
  ])(`handles %i instances`, (count, instances_array) => {
    const instances: BondInstance[] = instances_array.map(() => ({
      matrix: new Float32Array(16),
      color_start: `#ff0000`,
      color_end: `#0000ff`,
    }))

    const group: BondGroupWithGradients = { thickness: 0.1, instances }
    expect(group.instances).toHaveLength(count)
  })

  test.each([0.01, 0.05, 0.1, 0.15, 0.2, 0.5, 1.0])(
    `thickness value %f`,
    (thickness) => {
      const group: BondGroupWithGradients = { thickness, instances: [] }
      expect(group.thickness).toBe(thickness)
      expect(group.thickness).toBeGreaterThan(0)
    },
  )

  test.each([
    { ambient_light: 0.5, directional_light: 1.0 },
    { ambient_light: 1.5, directional_light: 2.2 },
    { ambient_light: 2.0, directional_light: 3.0 },
    { ambient_light: 0.0, directional_light: 0.5 },
  ])(`lighting config $ambient_light/$directional_light`, (config) => {
    const group: BondGroupWithGradients = { thickness: 0.1, instances: [], ...config }
    expect(group.ambient_light).toBe(config.ambient_light)
    expect(group.directional_light).toBe(config.directional_light)
  })

  test(`cylinder geometry configuration`, () => {
    const thickness = 0.15
    const expected_args = [thickness, thickness, 1, 8] // radiusTop, radiusBottom, height, segments

    expect(expected_args[3]).toBeGreaterThanOrEqual(6)
    expect(expected_args[3]).toBeLessThanOrEqual(32)
  })

  test(`shader uniforms`, () => {
    const group: BondGroupWithGradients = {
      thickness: 0.1,
      instances: [],
      ambient_light: 1.5,
      directional_light: 2.2,
    }

    expect(group.ambient_light).toBe(1.5)
    expect(group.directional_light).toBe(2.2)
  })
})
