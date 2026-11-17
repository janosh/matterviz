import type { Matrix3x3, Vec3 } from '#lib/math.js'
import * as math from '#lib/math.js'
import { EllipsoidAtoms } from '#lib/structure/ellipsoid-atoms.js'
import {
  chi3_cdf,
  ellipsoid_scale,
  symmetric_eigen_3x3,
  thermal_ellipsoid,
} from '#lib/structure/thermal-ellipsoids.js'
import { Color, InstancedMesh } from 'three/webgpu'
import { describe, expect, test } from 'vite-plus/test'

const max_abs_diff = (mat_a: Matrix3x3, mat_b: Matrix3x3): number =>
  Math.max(...mat_a.flat().map((val, idx) => Math.abs(val - mat_b.flat()[idx])))

describe(`thermal ellipsoids`, () => {
  // oxfmt-ignore
  test.each([
    [`anisotropic ADP`, [[0.0347, 0.0006, 0.0055], [0.0006, 0.026, 0.0009], [0.0055, 0.0009, 0.0345]]],
    [`diagonal`, [[3, 0, 0], [0, 1, 0], [0, 0, 2]]],
    [`degenerate pair`, [[2, 1, 0], [1, 2, 0], [0, 0, 3]]],
    [`isotropic`, [[0.02, 0, 0], [0, 0.02, 0], [0, 0, 0.02]]],
    [`negative entries`, [[1, -2, 0.5], [-2, -3, 1], [0.5, 1, 4]]],
  ] as [string, Matrix3x3][])(`eigen-decomposes a symmetric %s matrix`, (_name, matrix) => {
    const { values, vectors } = symmetric_eigen_3x3(matrix)
    expect(values).toEqual(values.toSorted((val_a, val_b) => val_a - val_b))
    // a proper rotation (orthonormal, det +1) reconstructing the input to a few f64 eps
    const scale = Math.max(...matrix.flat().map(Math.abs))
    const gram = math.dot(math.transpose_3x3(vectors), vectors)
    expect(max_abs_diff(gram, math.IDENTITY_3X3)).toBeLessThan(1e-14)
    expect(math.det_3x3(vectors)).toBeCloseTo(1, 14)
    const diag = math.IDENTITY_3X3.map((row, idx) => row.map((val) => val * values[idx]))
    const rebuilt = math.dot(math.dot(vectors, diag as Matrix3x3), math.transpose_3x3(vectors))
    expect(max_abs_diff(rebuilt, matrix)).toBeLessThan(1e-14 * scale)
  })

  // references: scipy.stats.chi(3).ppf(p)
  test.each([
    [0.1, 0.7644438332246415],
    [0.3, 1.1931689918177055],
    [0.5, 1.5381722544550522],
    [0.9, 2.5002777108094056],
    [0.99, 3.368214175218727],
  ])(`ellipsoid scale at p = %s matches scipy's chi(3) quantile`, (probability, expected) => {
    // bisection to f64 resolution: within 1e-13 of scipy (|value| < 4, ~100 eps)
    expect(Math.abs(ellipsoid_scale(probability) - expected)).toBeLessThan(1e-13)
    expect(Math.abs(chi3_cdf(expected) - probability)).toBeLessThan(1e-14)
  })

  test.each([0, 1, -0.5, Number.NaN])(`rejects probability %s`, (probability) => {
    expect(() => ellipsoid_scale(probability)).toThrow(
      `Ellipsoid probability must be in (0, 1)`,
    )
  })

  // diagonal U: the principal axes are the Cartesian ones, semi-axes c_p (0.1, 0.2, 0.3) Å
  test(`semi-axes are c_p √λ for the eigenvalues of U`, () => {
    // oxfmt-ignore
    const adp: Matrix3x3 = [[0.01, 0, 0], [0, 0.04, 0], [0, 0, 0.09]]
    const ellipsoid = thermal_ellipsoid(adp, 0.5)
    if (!ellipsoid) throw new Error(`expected an ellipsoid`)
    const { semi_axes, axes, transform } = ellipsoid
    const scale = 1.5381722544550522
    const expected = [0.1, 0.2, 0.3].map((sqrt_eigval) => scale * sqrt_eigval)
    expect(
      Math.max(...semi_axes.map((axis, idx) => Math.abs(axis - expected[idx]))),
    ).toBeLessThan(1e-15)
    expect(axes.map((row) => row.map(Math.abs))).toEqual(math.IDENTITY_3X3)
    // the unit-sphere map's columns are the semi-axis vectors: transform · transform^T = c_p² U
    const outer = math.dot(transform, math.transpose_3x3(transform))
    const scaled_adp = adp.map((row) => row.map((val) => scale ** 2 * val)) as Matrix3x3
    expect(max_abs_diff(outer, scaled_adp)).toBeLessThan(1e-15)
  })

  // a refinement artifact, drawn as a plain sphere by the viewer
  test(`has no ellipsoid for a non-positive-definite tensor`, () => {
    // oxfmt-ignore
    const adp: Matrix3x3 = [[0.01, 0, 0], [0, -0.002, 0], [0, 0, 0.03]]
    expect(thermal_ellipsoid(adp, 0.5)).toBeNull()
  })

  // edit-atoms mode's image atoms go to a ghost group: faded toward gray at half opacity
  test(`EllipsoidAtoms ghost group fades colors and halves opacity`, () => {
    const ellipsoid = math.IDENTITY_3X3.map((row) => math.scale([...row], 0.5)) as Matrix3x3
    const atoms = [{ position: [0, 0, 0] as Vec3, radius: 1, color: `#ff0000`, ellipsoid }]
    const [solid, ghost] = [false, true].map((is_ghost) => new EllipsoidAtoms(is_ghost))
    const [red, faded] = [solid, ghost].map((group) => {
      group.update(atoms, 8)
      group.set_opacity(0.8)
      const mesh = group.children.find((child) => child instanceof InstancedMesh)
      if (!mesh) throw new Error(`expected an ellipsoid mesh`)
      expect(mesh.material).toMatchObject({ opacity: group === ghost ? 0.4 : 0.8 })
      return mesh.getColorAt(0, new Color()).toArray()
    })
    // instance colors are float32: |error| <= 6e-8 on channels <= 1, under closeTo's 5e-7
    const expected = new Color().fromArray(red).lerp(new Color(0x999999), 0.4).toArray()
    expect(faded).toEqual(expected.map((val) => expect.closeTo(val, 6)))
  })
})
