import type { Vec3 } from '$lib/math'
import type { Complex } from './types'

export const multiply_complex = (left: Complex, right: Complex): Complex => [
  left[0] * right[0] - left[1] * right[1],
  left[0] * right[1] + left[1] * right[0],
]

export const complex_phase = (angle: number): Complex => [Math.cos(angle), Math.sin(angle)]

interface ComplexModeDisplacementFrame {
  phase: number
  displacements: Vec3[]
}

interface ComplexModeDisplacementOptions {
  amplitude: number
  n_frames: number
  label?: string
  // Raw forward-DFT coefficients reconstruct with exp(+i phase); phonon eigenvectors
  // conventionally evolve with exp(-i phase).
  time_dependence?: `exp_negative_i_phase` | `exp_positive_i_phase`
}

const complex_vector_max_norm = (vector: Complex[]): number => {
  let real_norm_squared = 0
  let imaginary_norm_squared = 0
  let real_imaginary_dot = 0
  for (const [real_part, imaginary_part] of vector) {
    real_norm_squared += real_part ** 2
    imaginary_norm_squared += imaginary_part ** 2
    real_imaginary_dot += real_part * imaginary_part
  }
  const discriminant = Math.hypot(
    real_norm_squared - imaginary_norm_squared,
    2 * real_imaginary_dot,
  )
  return Math.sqrt(
    Math.max(0, (real_norm_squared + imaginary_norm_squared + discriminant) / 2),
  )
}

// Sample one phase cycle of complex Cartesian displacements, normalizing only the
// display amplitude while leaving the caller's coefficients untouched.
export function complex_mode_displacement_frames(
  complex_displacements: Complex[][],
  options: ComplexModeDisplacementOptions,
): ComplexModeDisplacementFrame[] {
  const {
    amplitude,
    n_frames,
    label = `Complex mode`,
    time_dependence = `exp_negative_i_phase`,
  } = options
  if (!(amplitude > 0) || !Number.isFinite(amplitude)) {
    throw new Error(`${label} amplitude must be finite and > 0`)
  }
  if (!Number.isInteger(n_frames) || n_frames < 2) {
    throw new Error(`${label} animation needs at least 2 integer frames`)
  }
  if (
    time_dependence !== `exp_negative_i_phase` &&
    time_dependence !== `exp_positive_i_phase`
  ) {
    throw new TypeError(`${label} has unsupported time dependence '${time_dependence}'`)
  }
  let maximum = 0
  for (const [atom_idx, atom_vector] of complex_displacements.entries()) {
    if (atom_vector.length !== 3) {
      throw new Error(
        `${label} atom ${atom_idx} has ${atom_vector.length} components, expected 3`,
      )
    }
    for (const [component_idx, component] of atom_vector.entries()) {
      if (component.length !== 2 || !component.every(Number.isFinite)) {
        throw new TypeError(
          `${label} atom ${atom_idx} component ${component_idx} must contain two finite values`,
        )
      }
    }
    maximum = Math.max(maximum, complex_vector_max_norm(atom_vector))
  }
  if (!(maximum > 0)) throw new Error(`${label} has zero displacement`)
  const scale = amplitude / maximum
  const imaginary_sign = time_dependence === `exp_negative_i_phase` ? 1 : -1
  return Array.from({ length: n_frames }, (_unused, frame_idx) => {
    const phase = (2 * Math.PI * frame_idx) / n_frames
    const cosine = Math.cos(phase)
    const sine = Math.sin(phase)
    return {
      phase,
      displacements: complex_displacements.map(
        (atom_vector) =>
          atom_vector.map(
            ([real_part, imaginary_part]) =>
              scale * (real_part * cosine + imaginary_sign * imaginary_part * sine),
          ) as Vec3,
      ),
    }
  })
}
