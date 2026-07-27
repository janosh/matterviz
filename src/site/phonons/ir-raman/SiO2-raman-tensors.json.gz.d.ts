// Decompressed by vite-plugin-json-gz at import time. Polarizability derivative tensors
// (one 3x3 per mode, Raman-silent modes zero-filled) plus the irrep label of each mode.
import type { Matrix3x3 } from '$lib/math'

declare const doc: { mode_labels: string[]; raman_tensors: Matrix3x3[] }
export default doc
