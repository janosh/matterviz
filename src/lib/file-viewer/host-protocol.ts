// Message shapes exchanged between the webview (main.ts / host-bridge.ts) and whatever
// host embeds it (the VS Code extension, or a desktop host speaking the same protocol).
import type { PartialSettings } from '#lib/settings.js'
import type { ThemeName } from '#lib/theme/index.js'
import type { Vec3 } from '#lib/math.js'
import { cart_to_frac_with_fallback } from '#lib/structure/parsers/shared.js'
import { site_stride, vector_offset } from '#lib/structure/site.js'
import type { FrameChannels, NumericFrame } from '#lib/trajectory/frame.js'
import type { TrajectoryMetadata, TrajectoryRunSummary } from '#lib/trajectory/index.js'

export interface FileData {
  filename: string
  content: string
  is_base64: boolean
}

// Preserve which side of host file loading failed across the message boundary.
export class HostFileError extends Error {
  constructor(
    message: string,
    readonly stage: `acquire` | `parse`,
  ) {
    super(message)
    this.name = 'HostFileError'
  }
}

export interface WebviewBootstrapData {
  data: FileData
  theme: ThemeName
  defaults?: PartialSettings
  moyo_wasm_url?: string
  // matterviz.telemetry: post playback/transport summaries for the host's output channel
  telemetry?: boolean
}

// The host's bootstrap script inlines `window.matterviz_data = ...` before the webview loads
declare global {
  var matterviz_data: WebviewBootstrapData | undefined
}

type HostFileRequest = {
  file_path: string
  // The host picks a per-format indexer/decoder from the name. The VS Code
  // extension derives its own from `file_path`, but hosts that index by name
  // reject the request without this, so the webview always sends it.
  filename: string
}

// Requests the host answers with a HostToWebviewMessage carrying the same request_id
export type HostRequest =
  | ({ command: `request_large_file` } & HostFileRequest)
  // channels: the vectors to read and send (all when absent), as for TrajectoryRun.read_frame
  | ({
      command: `request_frame`
      frame_index: number
      channels?: FrameChannels
    } & HostFileRequest)

// The host watches the rendered file itself (no webview subscription step)
export type FileChangeMessage =
  | { command: `fileUpdated`; file_path: string; data: FileData; theme?: ThemeName }
  | { command: `fileDeleted`; file_path: string }

// Theme or settings changed on the host; the webview re-applies them to the view it already
// holds instead of the host rebuilding the HTML (which would re-read the file from disk)
export type SettingsChangedMessage = {
  command: `settingsChanged`
  theme: ThemeName
  // Always sent (a theme-only push still carries the current defaults) so the webview never
  // mistakes a missing field for "reset to DEFAULTS"
  defaults: PartialSettings
}

export type WebviewToHostMessage =
  | { command: `info` | `error`; text: string }
  // One telemetry summary (see telemetry.ts), logged by the host as a JSON line
  | { command: `telemetry`; record: Record<string, unknown> & { kind: string } }
  | (HostRequest & { request_id: string })
  // Text as is, binary exports as their bytes (an ArrayBuffer, see WireFrame below)
  | { command: `saveAs`; filename: string; content: string | ArrayBuffer }

// Replies carry the request_id of the WebviewToHostMessage they answer
export type HostToWebviewMessage =
  | FileChangeMessage
  | SettingsChangedMessage
  | {
      command: `large_file_response`
      request_id: string
      // The host keeps the run; the webview streams frames with request_frame. Frame 0
      // travels binary (as preview) rather than as the summary's JSON Site records, which
      // were 5.6x the bytes (20k atoms: 5.3 vs 0.96 MB) and parsed on the webview thread.
      run_summary?: Omit<TrajectoryRunSummary, `preview`>
      preview?: WireFrame
      error?: string
      error_stage?: `acquire` | `parse`
    }
  | {
      command: `frame_response`
      request_id: string
      frame_index?: number
      frame?: WireFrame | null
      error?: string
      // host-side milliseconds reading the frame from its source and encoding it for the wire
      timing?: { read_ms: number; encode_ms: number }
    }
  // Progressive per-frame plot rows, batched after large_file_response under its request_id
  // (not file_path: a re-request of the same file opens its run before the old one is disposed)
  | {
      command: `plot_metadata_stream`
      request_id: string
      rows: TrajectoryMetadata[]
      complete: boolean
    }
  // Parse warnings the run's later reads added since its summary or last such message
  | { command: `trajectory_warnings`; request_id: string; warnings: readonly string[] }

// A numeric frame as hosts post it, its typed arrays as ArrayBuffers: VS Code's webview
// postMessage recreates ArrayBuffers (engines >= 1.57) but turns typed arrays into plain
// index-keyed objects. Coordinates and atomic numbers stay binary instead of becoming one
// JSON Site record per atom (2.5x the bytes plus a decode on each side).
// `fractional: 'derived'`: coordinates omit each site's abc (3 floats after xyz), which
// frame_from_wire recomputes bit for bit from xyz and the lattice (see fractional_deriver).
// `quantized`: a display frame (FrameChannels.precision): xyz as uint16 steps in
// `coordinates`, each vector as 3 bytes in `vectors` (see WireQuantization).
// `sites: 'preview'`: the atomic numbers equal the run summary preview's (frame 0), which the
// webview already holds, so most frames of a fixed-species run don't repeat 1 byte per atom.
export type WireFrame = Omit<NumericFrame, `coordinates` | `sites` | `scalar_columns`> & {
  coordinates: ArrayBuffer
  fractional?: `derived`
  quantized?: WireQuantization
  vectors?: ArrayBuffer
  sites: Exclude<NumericFrame[`sites`], Uint8Array> | ArrayBuffer | `preview`
  scalar_columns?: Record<string, ArrayBuffer>
}

// Binary payload of a posted frame (what telemetry counts as wire bytes)
export const wire_frame_bytes = ({ coordinates, vectors, sites, scalar_columns }: WireFrame) =>
  coordinates.byteLength +
  (vectors?.byteLength ?? 0) +
  (sites instanceof ArrayBuffer ? sites.byteLength : 0) +
  Object.values(scalar_columns ?? {}).reduce((sum, column) => sum + column.byteLength, 0)

// A view's own bytes: a view into a larger (or shared) buffer would post all of it
const own_buffer = (view: Float64Array | Uint8Array): ArrayBuffer =>
  view.buffer instanceof ArrayBuffer && view.byteLength === view.buffer.byteLength
    ? view.buffer
    : view.slice().buffer

// Fractional coordinates as the readers derive them (create_numeric_md_frame): the lattice's
// cart->frac map applied to xyz, zeros without a lattice. Both wire ends call this one function.
const fractional_deriver = (
  structure: NumericFrame[`structure`],
): ((xyz: Vec3, target: Vec3) => Vec3) => {
  const matrix = structure.lattice?.matrix
  if (!matrix) return (_xyz, target) => target.fill(0)
  return cart_to_frac_with_fallback(matrix).convert
}

// The xyz and vector columns alone (stride 3 + 3 per vector), or undefined when any site's
// stored abc differs from the derivation in a single bit (e.g. a fractional-coordinate source
// like XDATCAR whose xyz came from abc): then the frame travels whole
const without_derived_fractional = (
  frame: NumericFrame,
): Float64Array<ArrayBuffer> | undefined => {
  const { coordinates, sites, vector_keys } = frame
  const width = site_stride(vector_keys)
  const derive = fractional_deriver(frame.structure)
  const xyz: Vec3 = [0, 0, 0]
  const abc: Vec3 = [0, 0, 0]
  const compact = new Float64Array(sites.length * (width - 3))
  for (let idx = 0; idx < sites.length; idx++) {
    const offset = idx * width
    xyz[0] = coordinates[offset]
    xyz[1] = coordinates[offset + 1]
    xyz[2] = coordinates[offset + 2]
    derive(xyz, abc)
    // Object.is: -0 vs 0 and NaN payloads count as different values
    for (let axis = 0; axis < 3; axis++)
      if (!Object.is(abc[axis], coordinates[offset + 3 + axis])) return undefined
    const target = idx * (width - 3)
    compact.set(coordinates.subarray(offset, offset + 3), target)
    compact.set(coordinates.subarray(offset + 6, offset + width), target + 3)
  }
  return compact
}

// A display frame (FrameChannels.precision 'display') for playback. xyz: 16-bit steps across
// each axis's range in the frame (value = origin + q * step), at most step / 2 = range / 131070
// off (0.8 mÅ across a 100 Å box). Vectors (forces, velocities): 3 bytes each, the direction
// as an octahedral 8+8-bit code and the length on a 254-step log scale between the frame's
// smallest nonzero and largest length of that vector (code 0: a zero vector). On MD forces and
// velocities that stays within 0.8° (p99) and 0.8% of the largest length, where 8 bits per
// component would turn small vectors by tens of degrees (wrong arrows when normalized).
// Fractional coordinates derive from the rounded xyz. Undefined for a non-finite value.
export type WireQuantization = {
  origin: number[]
  step: number[]
  // natural log of each vector's smallest nonzero and largest length
  vector_log_range: [number, number][]
}
const QUANT_LEVELS = 65_535
const OCT_LEVELS = 255
const LOG_LEVELS = 254
const sign_of = (value: number): number => (value < 0 ? -1 : 1)

const quantize = (
  frame: NumericFrame,
):
  | {
      values: Uint16Array<ArrayBuffer>
      vectors: Uint8Array<ArrayBuffer>
      quantized: WireQuantization
    }
  | undefined => {
  const { coordinates, sites, vector_keys } = frame
  const n_sites = sites.length
  if (n_sites === 0) return undefined
  const width = site_stride(vector_keys)
  const origin = [Infinity, Infinity, Infinity]
  const top = [-Infinity, -Infinity, -Infinity]
  const lengths = new Float64Array(n_sites * vector_keys.length)
  const vector_log_range = vector_keys.map((): [number, number] => [Infinity, -Infinity])
  for (let idx = 0; idx < n_sites; idx++) {
    const offset = idx * width
    for (let axis = 0; axis < 3; axis++) {
      const value = coordinates[offset + axis]
      if (!Number.isFinite(value)) return undefined
      if (value < origin[axis]) origin[axis] = value
      if (value > top[axis]) top[axis] = value
    }
    for (let vec = 0; vec < vector_keys.length; vec++) {
      const start = offset + vector_offset(vec)
      const length = Math.hypot(
        coordinates[start],
        coordinates[start + 1],
        coordinates[start + 2],
      )
      if (!Number.isFinite(length)) return undefined
      lengths[idx * vector_keys.length + vec] = length
      if (length > 0) {
        const range = vector_log_range[vec]
        const log_length = Math.log(length)
        if (log_length < range[0]) range[0] = log_length
        if (log_length > range[1]) range[1] = log_length
      }
    }
  }
  // all-zero vector columns: any range decodes their code 0 to zero
  for (const range of vector_log_range) if (range[0] > range[1]) range.fill(0)
  const step = origin.map((low, axis) => (top[axis] - low) / QUANT_LEVELS || 1)
  const values = new Uint16Array(n_sites * 3)
  const vectors = new Uint8Array(n_sites * vector_keys.length * 3)
  for (let idx = 0; idx < n_sites; idx++) {
    const offset = idx * width
    for (let axis = 0; axis < 3; axis++)
      values[idx * 3 + axis] = Math.round(
        (coordinates[offset + axis] - origin[axis]) / step[axis],
      )
    for (let vec = 0; vec < vector_keys.length; vec++) {
      const length = lengths[idx * vector_keys.length + vec]
      if (length === 0) continue // code 0 (and any direction) is the zero vector
      const start = offset + vector_offset(vec)
      const target = (idx * vector_keys.length + vec) * 3
      const [x_val, y_val, z_val] = [
        coordinates[start],
        coordinates[start + 1],
        coordinates[start + 2],
      ]
      const l1 = Math.abs(x_val) + Math.abs(y_val) + Math.abs(z_val)
      let oct_u = x_val / l1
      let oct_v = y_val / l1
      if (z_val < 0)
        [oct_u, oct_v] = [
          (1 - Math.abs(oct_v)) * sign_of(oct_u),
          (1 - Math.abs(oct_u)) * sign_of(oct_v),
        ]
      vectors[target] = Math.round(((oct_u + 1) / 2) * OCT_LEVELS)
      vectors[target + 1] = Math.round(((oct_v + 1) / 2) * OCT_LEVELS)
      const [log_low, log_high] = vector_log_range[vec]
      const span = log_high - log_low
      vectors[target + 2] =
        1 + (span > 0 ? Math.round(((Math.log(length) - log_low) / span) * LOG_LEVELS) : 0)
    }
  }
  return { values, vectors, quantized: { origin, step, vector_log_range } }
}

// `precision: 'display'` (a frame shown in motion, see FrameChannels) sends it quantized;
// otherwise the frame is exact, without abc when that derives bit for bit. `preview_sites`:
// the atomic numbers of the run's summary preview, which a frame with the same ones omits
export const frame_to_wire = (
  frame: NumericFrame,
  precision?: `display`,
  preview_sites?: Uint8Array,
): WireFrame => {
  const { coordinates, sites, scalar_columns, ...rest } = frame
  const display = precision === `display` ? quantize(frame) : undefined
  const compact = display ? undefined : without_derived_fractional(frame)
  const same_sites =
    sites instanceof Uint8Array &&
    preview_sites?.length === sites.length &&
    preview_sites.every((number, idx) => number === sites[idx])
  return {
    ...rest,
    coordinates: display?.values.buffer ?? compact?.buffer ?? own_buffer(coordinates),
    ...(display && {
      quantized: display.quantized,
      vectors: display.vectors.buffer,
      fractional: `derived` as const,
    }),
    ...(compact && { fractional: `derived` as const }),
    sites: same_sites ? `preview` : sites instanceof Uint8Array ? own_buffer(sites) : sites,
    ...(scalar_columns && {
      scalar_columns: Object.fromEntries(
        Object.entries(scalar_columns).map(([key, column]) => [key, own_buffer(column)]),
      ),
    }),
  }
}

// xyz and vector columns as with_derived_fractional takes them: per site [xyz, vectors...]
const dequantize = (
  values: Uint16Array,
  vectors: Uint8Array,
  { origin, step, vector_log_range }: WireQuantization,
): Float64Array<ArrayBuffer> => {
  const n_vectors = vector_log_range.length
  const n_sites = values.length / 3
  const width = 3 + 3 * n_vectors
  const decoded = new Float64Array(n_sites * width)
  for (let idx = 0; idx < n_sites; idx++) {
    const target = idx * width
    for (let axis = 0; axis < 3; axis++)
      decoded[target + axis] = origin[axis] + values[idx * 3 + axis] * step[axis]
    for (let vec = 0; vec < n_vectors; vec++) {
      const source = (idx * n_vectors + vec) * 3
      const code = vectors[source + 2]
      if (code === 0) continue // zero vector (the array starts zeroed)
      const [log_low, log_high] = vector_log_range[vec]
      const length = Math.exp(log_low + ((code - 1) / LOG_LEVELS) * (log_high - log_low))
      let x_val = (vectors[source] / OCT_LEVELS) * 2 - 1
      let y_val = (vectors[source + 1] / OCT_LEVELS) * 2 - 1
      const z_val = 1 - Math.abs(x_val) - Math.abs(y_val)
      const fold = Math.max(-z_val, 0)
      x_val -= sign_of(x_val) * fold
      y_val -= sign_of(y_val) * fold
      const scale = length / Math.hypot(x_val, y_val, z_val)
      const offset = target + 3 + 3 * vec
      decoded[offset] = x_val * scale
      decoded[offset + 1] = y_val * scale
      decoded[offset + 2] = z_val * scale
    }
  }
  return decoded
}

const with_derived_fractional = (wire: Float64Array, frame: NumericFrame): Float64Array => {
  const width = site_stride(frame.vector_keys)
  const coordinates = new Float64Array(frame.sites.length * width)
  const derive = fractional_deriver(frame.structure)
  const xyz: Vec3 = [0, 0, 0]
  const abc: Vec3 = [0, 0, 0]
  for (let idx = 0; idx < frame.sites.length; idx++) {
    const source = idx * (width - 3)
    const target = idx * width
    xyz[0] = wire[source]
    xyz[1] = wire[source + 1]
    xyz[2] = wire[source + 2]
    coordinates.set(xyz, target)
    coordinates.set(derive(xyz, abc), target + 3)
    coordinates.set(wire.subarray(source + 3, source + width - 3), target + 6)
  }
  return coordinates
}

// Throws on a frame a host posted without frame_to_wire: its typed arrays arrive as plain
// objects that would decode to empty columns, a materialized frame has no columns at all
// `preview_sites`: the atomic numbers of the run summary preview, for `sites: 'preview'`
export const frame_from_wire = (wire: WireFrame, preview_sites?: Uint8Array): NumericFrame => {
  const {
    coordinates,
    sites: wire_sites,
    scalar_columns,
    fractional,
    quantized,
    vectors,
    ...rest
  } = wire
  if (wire_sites === `preview` && !preview_sites)
    throw new Error(`Malformed host frame: it reuses preview sites, but there is no preview`)
  // a copy: frames may be transferred to a preparation worker, detaching their buffers
  const sites = wire_sites === `preview` ? preview_sites?.slice().buffer : wire_sites
  const columns = Object.values(scalar_columns ?? {})
  if (
    !(coordinates instanceof ArrayBuffer) ||
    !(sites instanceof ArrayBuffer || Array.isArray(sites)) ||
    !columns.every((column) => column instanceof ArrayBuffer)
  )
    throw new Error(
      `Malformed host frame: expected ArrayBuffer coordinates and sites (see frame_to_wire), got fields ${Object.keys(wire).join(`, `)}`,
    )
  if (fractional !== undefined && fractional !== `derived`)
    throw new Error(`Malformed host frame: unknown fractional encoding ${fractional}`)
  const n_sites = sites instanceof ArrayBuffer ? sites.byteLength : sites.length
  const n_vectors = rest.vector_keys.length
  if (
    quantized &&
    (!fractional ||
      quantized.origin.length !== 3 ||
      quantized.step.length !== 3 ||
      quantized.vector_log_range?.length !== n_vectors ||
      !(vectors instanceof ArrayBuffer) ||
      vectors.byteLength !== n_sites * n_vectors * 3)
  )
    throw new Error(
      `Malformed host frame: quantization for ${quantized.origin.length} axes and ${quantized.vector_log_range?.length} vectors (${vectors?.byteLength} vector bytes), expected 3 axes with derived abc and ${n_vectors} vectors for ${n_sites} sites`,
    )
  const coordinate_bytes = quantized
    ? n_sites * 3 * Uint16Array.BYTES_PER_ELEMENT
    : n_sites * (site_stride(rest.vector_keys) - (fractional ? 3 : 0)) * 8
  if (coordinates.byteLength !== coordinate_bytes)
    throw new Error(
      `Malformed host frame: ${coordinates.byteLength} coordinate bytes for ${n_sites} sites with vectors [${rest.vector_keys}]`,
    )
  // one value per site, else sites past a short column would read undefined
  for (const [key, column] of Object.entries(scalar_columns ?? {}))
    if (column.byteLength !== n_sites * Float64Array.BYTES_PER_ELEMENT)
      throw new Error(
        `Malformed host frame: scalar column ${key} has ${column.byteLength} bytes for ${n_sites} sites`,
      )
  const frame: NumericFrame = {
    ...rest,
    coordinates:
      quantized && vectors
        ? dequantize(new Uint16Array(coordinates), new Uint8Array(vectors), quantized)
        : new Float64Array(coordinates),
    sites: sites instanceof ArrayBuffer ? new Uint8Array(sites) : sites,
    ...(scalar_columns && {
      scalar_columns: Object.fromEntries(
        Object.entries(scalar_columns).map(([key, column]) => [key, new Float64Array(column)]),
      ),
    }),
  }
  if (fractional) frame.coordinates = with_derived_fractional(frame.coordinates, frame)
  if (quantized) frame.approximate = true
  return frame
}
