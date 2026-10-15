// Decompressed by vite-plugin-json-gz at import time. Same shape as the SiO2 fixture, but
// synthetic: the Raman input of the closed-form CO2 checks and of the explorer's CO2 example.
import type { Matrix3x3 } from '#lib/math.js'

declare const doc: { mode_labels: string[]; raman_tensors: Matrix3x3[] }
export default doc
