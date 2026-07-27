// Decompressed by vite-plugin-json-gz at import time. Same shape as the SiO2 fixture, but
// synthetic and test-only: it exists so the closed-form CO2 checks have a Raman input.
import type { Matrix3x3 } from '$lib/math'

declare const doc: { mode_labels: string[]; raman_tensors: Matrix3x3[] }
export default doc
