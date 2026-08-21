// Parsers for measured powder-diffraction files. Every parser either returns a pattern or
// throws an Error naming the format and what was missing — no parser guesses a start angle
// or step size, because a wrong x axis looks exactly like a real scan.
import { to_error } from '$lib/utils'
import type { XrdPattern } from './index'

// Maximum number of data points to keep after subsampling for rendering performance
const MAX_POINTS = 1000

const NUMBER_RE = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/

// Leading numeric tokens of a whitespace/comma separated line (a trailing `,` or `.` on a
// token is tolerated: PSI writes `18000000.,`). Stops at the first non-numeric token.
const leading_numbers = (line: string): number[] => {
  const values: number[] = []
  for (const token of line.trim().split(/[\s,]+/)) {
    const cleaned = token.replace(/[.,]$/, ``)
    if (!NUMBER_RE.test(cleaned)) break
    values.push(Number(cleaned))
  }
  return values
}

// Number following the first header line whose start matches `key` (a regex source including
// the separator, e.g. `\\*START\\s*=\\s*`), else null. The first of several `keys` that
// resolves wins.
const header_number = (lines: string[], keys: string[], flags = ``): number | null => {
  for (const key of keys) {
    const pattern = new RegExp(`^${key}(?<value>[-+.\\deE]+)`, flags)
    for (const line of lines) {
      const value = pattern.exec(line)?.groups?.value
      if (value !== undefined && NUMBER_RE.test(value)) return Number(value)
    }
  }
  return null
}

// [header line, body] of the section opened by the first line matching `start`: the trimmed
// non-empty lines up to (not including) the first line matching `end`. Null without `start`.
function find_section(lines: string[], start: RegExp, end: RegExp) {
  const start_idx = lines.findIndex((line) => start.test(line.trim()))
  if (start_idx === -1) return null
  const body: string[] = []
  for (const line of lines.slice(start_idx + 1)) {
    const trimmed = line.trim()
    if (end.test(trimmed)) break
    if (trimmed) body.push(trimmed)
  }
  return [lines[start_idx].trim(), body] as const
}

// x from a uniform grid; the count is the intensity count so the two stay aligned
const uniform_grid = (start: number, step: number, count: number): number[] =>
  Array.from({ length: count }, (_, idx) => start + idx * step)

// Counts on the [start, step] grid a header announced; `missing` names the keys when it did not
type Grid = [start: number | null, step: number | null]
function grid_pattern(values: number[], [start, step]: Grid, format: string, missing: string) {
  if (start === null || step === null || !(step > 0)) throw new Error(`${format}: ${missing}`)
  return finalize(uniform_grid(start, step, values.length), values, format)
}

// Normalize y to 0-100 and subsample long scans, preserving the strongest local maxima.
// Shared final step so every format renders on the same scale.
function finalize(x_values: number[], y_values: number[], format: string): XrdPattern {
  if (x_values.length === 0) throw new Error(`${format}: no intensity data found`)
  if (x_values.length !== y_values.length) {
    throw new Error(`${format}: ${x_values.length} angles but ${y_values.length} intensities`)
  }
  let max_y = -Infinity
  for (const val of y_values) if (val > max_y) max_y = val
  const scale = max_y > 0 ? 100 / max_y : 1
  const norm_y = y_values.map((val) => val * scale)
  return x_values.length > MAX_POINTS
    ? subsample_preserve_peaks(x_values, norm_y, MAX_POINTS)
    : { x: x_values, y: norm_y }
}

// Uniform sampling plus the strongest local maxima (up to 30% of the slots), so peaks that
// fall between uniform samples survive
function subsample_preserve_peaks(
  x_vals: number[],
  y_vals: number[],
  target_points: number,
): XrdPattern {
  const num_points = x_vals.length
  const peaks: number[] = []
  const threshold = Math.max(...y_vals) * 0.05 // 5% of max as significance threshold
  for (let idx = 1; idx < num_points - 1; idx++) {
    const [prev, val, next] = [y_vals[idx - 1], y_vals[idx], y_vals[idx + 1]]
    if (val > prev && val > next && val > threshold) peaks.push(idx)
  }
  const peak_slots = Math.min(peaks.length, Math.floor(target_points * 0.3))
  const uniform_slots = target_points - peak_slots
  const top_peaks = peaks
    .toSorted((idx_a, idx_b) => y_vals[idx_b] - y_vals[idx_a])
    .slice(0, peak_slots)
  const step = (num_points - 1) / Math.max(1, uniform_slots - 1)
  const uniform = Array.from({ length: uniform_slots }, (_, idx) => Math.round(idx * step))
  const selected = [...new Set([...uniform, ...top_peaks])].toSorted(
    (idx_a, idx_b) => idx_a - idx_b,
  )
  return { x: selected.map((idx) => x_vals[idx]), y: selected.map((idx) => y_vals[idx]) }
}

// Column data: every data row has at least two leading numbers (2θ, intensity[, error]).
// Comment lines start with #, ; or !. 2θ has to run one way (the majority direction): a
// stitched multi-range scan restarts once per range and a glitch reverses one step, so one
// reversal is always tolerated and longer scans one per ten steps. A column that is not 2θ,
// i.e. bare counts misread as columns or (intensity, error) pairs, reverses on roughly every
// other step whatever the file length.
export function parse_xy_file(content: string, format = `XY`): XrdPattern {
  const x_values: number[] = []
  const y_values: number[] = []
  let max_cols = 0
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || /^[#;!]/.test(trimmed)) continue
    const values = leading_numbers(trimmed)
    if (values.length < 2) continue
    x_values.push(values[0])
    y_values.push(values[1])
    max_cols = Math.max(max_cols, values.length)
  }
  if (x_values.length === 0) {
    throw new Error(`${format}: no rows with two numeric columns (2theta, intensity)`)
  }
  let ups = 0
  let downs = 0
  for (let idx = 1; idx < x_values.length; idx++) {
    const delta = x_values[idx] - x_values[idx - 1]
    if (delta > 0) ups++
    else if (delta < 0) downs++
  }
  const reversals = Math.min(ups, downs)
  if (reversals > Math.max(1, 0.1 * (ups + downs))) {
    const shape =
      max_cols >= 4
        ? `a block of bare counts, ${max_cols} per row`
        : `(intensity, error) pairs`
    throw new Error(
      `${format}: column 1 reverses direction in ${reversals} of ${ups + downs} steps, so it is not 2theta; the ${x_values.length} rows look like ${shape}`,
    )
  }
  return finalize(x_values, y_values, format)
}

// Header-and-block layout shared by the ILL (D1A/D2B) and PSI (DMC/HRPT) neutron formats: one
// line `start step stop [monitor]` followed by n = (stop − start)/step + 1 counts, usually
// ten per line, often followed by n standard deviations which are ignored.
export function parse_block_scan(content: string, format = `block scan`): XrdPattern {
  const lines = content.split(/\r?\n/)
  for (let line_idx = 0; line_idx < lines.length; line_idx++) {
    const [start, step, stop] = leading_numbers(lines[line_idx])
    if (step === undefined || stop === undefined || !(step > 0) || !(stop > start)) continue
    const count = Math.round((stop - start) / step) + 1
    if (count < 2 || Math.abs(start + (count - 1) * step - stop) > step / 2) continue
    const values: number[] = []
    for (const line of lines.slice(line_idx + 1)) {
      if (!line.trim()) continue
      const row = leading_numbers(line) // a row with any non-numeric token ends the block
      if (row.length !== line.trim().split(/[\s,]+/).length) break
      values.push(...row)
      if (values.length >= count) break
    }
    if (values.length < count) {
      throw new Error(
        `${format}: header '${lines[line_idx].trim()}' announces ${count} points but only ${values.length} follow`,
      )
    }
    return finalize(uniform_grid(start, step, count), values.slice(0, count), format)
  }
  throw new Error(`${format}: no 'start step stop' header line followed by a block of counts`)
}

// `.dat`/`.asc`/`.txt` are catch-all extensions: two-column scans, ILL/PSI count blocks and
// Rigaku ASCII all ship under them. Dispatch on content, reporting both failures if neither fits.
function parse_ascii_scan(content: string, format = `ASCII`): XrdPattern {
  if (/^\*START\s*=/m.test(content)) return parse_rigaku_asc_file(content)
  try {
    return parse_xy_file(content, format)
  } catch (xy_error) {
    try {
      return parse_block_scan(content, format)
    } catch (block_error) {
      throw new Error(`${to_error(xy_error).message}; ${to_error(block_error).message}`, {
        cause: block_error,
      })
    }
  }
}

// Rigaku ASCII (.asc): `*KEY = value` header with *START, *STOP, *STEP (degrees) and *COUNT,
// then the counts between *BEGIN and *END, several per line, comma separated.
export function parse_rigaku_asc_file(content: string): XrdPattern {
  const lines = content.split(/\r?\n/)
  const [start, step, stop, count] = [`START`, `STEP`, `STOP`, `COUNT`].map((name) =>
    header_number(lines, [`\\*${name}\\s*=\\s*`]),
  )
  if (start === null || step === null || !(step > 0)) {
    throw new Error(`Rigaku ASC: missing *START or positive *STEP header`)
  }
  // blank lines yield no numbers, so only the `*KEY` header lines need excluding
  const values = lines.filter((line) => !line.trim().startsWith(`*`)).flatMap(leading_numbers)
  const expected =
    count ?? (stop === null ? values.length : Math.round((stop - start) / step) + 1)
  if (values.length !== expected) {
    throw new Error(
      `Rigaku ASC: header implies ${expected} points (*START ${start}, *STEP ${step}, *STOP ${stop}, *COUNT ${count}) but ${values.length} counts were read`,
    )
  }
  return finalize(uniform_grid(start, step, values.length), values, `Rigaku ASC`)
}

// Rigaku RAS: `*RAS_HEADER_START … *RAS_HEADER_END` then `*RAS_INT_START … *RAS_INT_END`. Data
// rows are `2theta intensity attenuation` (or just intensities, in which case the quoted
// *MEAS_SCAN_START / *MEAS_SCAN_STEP header values set the grid). Only the first scan is read.
export function parse_ras_file(content: string): XrdPattern {
  const lines = content.split(/\r?\n/)
  const section = find_section(lines, /^\*RAS_INT_START/i, /^\*RAS_INT_END/i)
  if (!section) throw new Error(`Rigaku RAS: no *RAS_INT_START section`)
  const [, data_lines] = section
  if (data_lines.length === 0) throw new Error(`Rigaku RAS: empty *RAS_INT_START section`)
  // Column rows (2theta intensity [attenuation]) versus counts listed several per line: a
  // scan has many rows, and a column row never carries more than three numbers
  const is_column_data =
    data_lines.length > 1 &&
    data_lines.every((line) => [2, 3].includes(leading_numbers(line).length))
  if (is_column_data) return parse_xy_file(data_lines.join(`\n`), `Rigaku RAS`)
  const start = header_number(lines, [`\\*MEAS_SCAN_START\\s+"?`])
  const step = header_number(lines, [`\\*MEAS_SCAN_STEP\\s+"?`])
  const missing = `single-column intensities need *MEAS_SCAN_START and a positive *MEAS_SCAN_STEP`
  return grid_pattern(
    data_lines.flatMap(leading_numbers),
    [start, step],
    `Rigaku RAS`,
    missing,
  )
}

// Siemens/Bruker UXD: `_KEY=VALUE` header, then either a `_2THETACOUNTS` section of
// `2theta counts` rows or a `_COUNTS` section of bare counts on the `_START`/`_STEPSIZE` grid.
export function parse_uxd_file(content: string): XrdPattern {
  const lines = content.split(/\r?\n/).filter((line) => !line.trim().startsWith(`;`))
  // the next `_KEY` header block ends the data
  const section = find_section(lines, /^_(?:2THETA)?COUNTS\b/i, /^_/)
  if (!section) throw new Error(`UXD: no _COUNTS or _2THETACOUNTS section`)
  const [header, data_lines] = section
  if (/^_2THETACOUNTS/i.test(header)) return parse_xy_file(data_lines.join(`\n`), `UXD`)
  // _START is the scanned drive's first position; _2THETA is the detector position at the
  // start, which only coincides for coupled scans, so it serves as the fallback
  const start = header_number(lines, [`_START\\s*=\\s*`, `_2THETA\\s*=\\s*`], `i`)
  const step = header_number(lines, [`_STEP(?:SIZE|WIDTH)\\s*=\\s*`], `i`)
  const missing = `_COUNTS section needs _START (or _2THETA) and a positive _STEPSIZE`
  return grid_pattern(data_lines.flatMap(leading_numbers), [start, step], `UXD`, missing)
}

// GSAS powder data. The BANK header reads
//   BANK n NCHAN NREC BINTYP BCOEF1 BCOEF2 BCOEF3 BCOEF4 [TYPE]
// with BINTYP CONST (BCOEF1 = start, BCOEF2 = step, both in centidegrees) and TYPE one of
// STD (counts), ESD (count, sigma pairs) or FXYE (x, y, sigma triplets, x in centidegrees).
// Time-of-flight banks (RALF, SLOG, …) have no 2θ axis and are rejected.
export function parse_gsas_file(content: string): XrdPattern {
  const lines = content.split(/\r?\n/)
  const bank_idx = lines.findIndex((line) => /^BANK\s/i.test(line))
  if (bank_idx === -1) throw new Error(`GSAS: no BANK header line`)
  const tokens = lines[bank_idx].trim().split(/\s+/)
  const [, , nchan_text, , bintyp = ``, bcoef1, bcoef2] = tokens
  const type = (tokens.at(-1) ?? `STD`).toUpperCase()
  const nchan = Number(nchan_text)
  if (!Number.isInteger(nchan) || nchan < 1) {
    throw new Error(`GSAS: BANK header '${lines[bank_idx].trim()}' has no valid NCHAN`)
  }
  if (bintyp.toUpperCase() !== `CONST`) {
    throw new Error(
      `GSAS: BINTYP '${bintyp}' is not a constant-step 2theta bank (only CONST is supported)`,
    )
  }
  const start = Number(bcoef1) / 100
  const step = Number(bcoef2) / 100
  if (type !== `FXYE` && (!Number.isFinite(start) || !(step > 0))) {
    throw new Error(
      `GSAS: BCOEF1/BCOEF2 '${bcoef1} ${bcoef2}' are not a valid start/step in centidegrees`,
    )
  }
  const stride = type === `FXYE` ? 3 : type === `ESD` ? 2 : 1
  // STD records are fixed-width 10(I2,F6.0): a 2-char detector count NCTR (blank or 1-99)
  // glued to a 6-char intensity. Split on whitespace a multi-detector bank yields NCTR and
  // intensity as separate tokens, interleaving 1..10 into the counts. Free-format STD lines
  // (length not a multiple of 8) still split on whitespace.
  const std_fields = (line: string): number[] | null => {
    if (stride !== 1 || line.length % 8 !== 0) return null
    const fields: number[] = []
    for (let pos = 0; pos < line.length; pos += 8) {
      const nctr = line.slice(pos, pos + 2)
      const count = line.slice(pos + 2, pos + 8)
      if (!/^\s*\d*$/.test(nctr)) return null
      if (!count.trim()) break // blank fields pad the last record
      if (!NUMBER_RE.test(count.trim())) return null
      fields.push(Number(count))
    }
    return fields
  }
  const values = lines
    .slice(bank_idx + 1)
    .filter((line) => line.trim() && !/^[#!]/.test(line))
    .flatMap((line) => std_fields(line) ?? leading_numbers(line))
  if (values.length < nchan * stride) {
    throw new Error(
      `GSAS: BANK declares ${nchan} channels of ${type} data (${nchan * stride} values) but ${values.length} follow`,
    )
  }
  const intensities = Array.from(
    { length: nchan },
    (_, idx) => values[idx * stride + (stride === 3 ? 1 : 0)],
  )
  const x_values =
    type === `FXYE`
      ? Array.from({ length: nchan }, (_, idx) => values[idx * 3] / 100)
      : uniform_grid(start, step, nchan)
  return finalize(x_values, intensities, `GSAS`)
}

// Bruker DIFFRAC RAW1.01 layout (little-endian), as documented by xylib: a 712-byte file
// header (range count at byte 12), then per range a range header — its own length (304) at
// byte 0, step count at 4, start 2θ (double) at 16, step size (double) at 176, supplementary
// header size at 256 — followed by that range's float32 counts; the next range header starts
// right after them. Ranges are concatenated in 2θ order.
export function parse_bruker_raw_file(data: ArrayBuffer): XrdPattern {
  const bytes = new Uint8Array(data)
  const magic = String.fromCharCode(...bytes.slice(0, 7))
  if (!magic.startsWith(`RAW`)) {
    throw new Error(`Bruker RAW: bad magic '${magic.slice(0, 4)}', expected 'RAW1.01'`)
  }
  if (magic !== `RAW1.01`) {
    throw new Error(
      `Bruker RAW: version '${magic}' is not supported (only RAW1.01). Export the scan as .uxd, .xy or .brml instead.`,
    )
  }
  const view = new DataView(data)
  if (bytes.length < 712 + 304) {
    throw new Error(
      `Bruker RAW1.01: file is ${bytes.length} bytes, shorter than the 1016-byte headers`,
    )
  }
  const range_count = view.getUint32(12, true)
  if (range_count < 1) throw new Error(`Bruker RAW1.01: file header announces 0 ranges`)
  const ranges: { start: number; x: number[]; y: number[] }[] = []
  let range_offset = 712 // the first range header follows the file header
  for (let range_idx = 1; range_idx <= range_count; range_idx++) {
    const label = `Bruker RAW1.01: range ${range_idx} of ${range_count}`
    if (range_offset + 304 > bytes.length) {
      throw new Error(
        `${label} header at byte ${range_offset} runs past the end of the ${bytes.length}-byte file`,
      )
    }
    const header_len = view.getUint32(range_offset, true)
    const steps = view.getUint32(range_offset + 4, true)
    const start = view.getFloat64(range_offset + 16, true)
    const step = view.getFloat64(range_offset + 176, true)
    const supplementary = view.getUint32(range_offset + 256, true)
    const data_offset = range_offset + header_len + supplementary
    if (!(steps > 0) || !(step > 0) || !Number.isFinite(start)) {
      throw new Error(`${label} header has steps=${steps}, start=${start}, step=${step}`)
    }
    if (data_offset + 4 * steps > bytes.length) {
      throw new Error(
        `${label} announces ${steps} float32 counts at byte ${data_offset} but the file ends at ${bytes.length}`,
      )
    }
    const y_values = Array.from({ length: steps }, (_, idx) =>
      view.getFloat32(data_offset + 4 * idx, true),
    )
    ranges.push({ start, x: uniform_grid(start, step, steps), y: y_values })
    range_offset = data_offset + 4 * steps
  }
  ranges.sort((range_a, range_b) => range_a.start - range_b.start)
  return finalize(
    ranges.flatMap((range) => range.x),
    ranges.flatMap((range) => range.y),
    `Bruker RAW1.01`,
  )
}

const parse_xml = (content: string, format: string): Document => {
  const doc = new DOMParser().parseFromString(content, `application/xml`)
  const parse_error = doc.querySelector(`parsererror`)?.textContent?.trim()
  if (parse_error) throw new Error(`${format}: invalid XML (${parse_error.split(`\n`)[0]})`)
  return doc
}

// Bruker .brml: a ZIP whose Experiment0/RawData0.xml holds the scan, either as <Datum>
// rows (`time,flag,2theta,theta,…,intensity` — 2θ is column 3, intensity the last column)
// or as an <Intensities>/<Counts> list on the <Start>/<Step> (or <Start>/<Stop>) grid.
export async function parse_brml_file(data: ArrayBuffer): Promise<XrdPattern> {
  const { unzipSync } = await import(`fflate`) // lazy, keeps fflate out of SSR bundles
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(new Uint8Array(data))
  } catch (exc) {
    throw new Error(`BRML: not a ZIP archive (${to_error(exc).message})`, { cause: exc })
  }
  const xml_names = Object.keys(files).filter((name) => name.toLowerCase().endsWith(`.xml`))
  const raw_name =
    xml_names.find((name) => name.toLowerCase().includes(`rawdata`)) ??
    xml_names.find((name) => {
      const text = new TextDecoder().decode(files[name])
      return [`<Datum>`, `<Intensities>`, `<Counts>`].some((tag) => text.includes(tag))
    })
  if (!raw_name) {
    throw new Error(`BRML: no RawData XML among ${Object.keys(files).length} archive entries`)
  }
  return parse_brml_xml(new TextDecoder().decode(files[raw_name]))
}

function parse_brml_xml(xml_content: string): XrdPattern {
  const doc = parse_xml(xml_content, `BRML`)
  const datum_rows = Array.from(doc.querySelectorAll(`Datum`), (el) =>
    (el.textContent ?? ``).trim().split(`,`).map(Number),
  ).filter(
    (row) =>
      row.length >= 5 && Number.isFinite(row[2]) && Number.isFinite(row[row.length - 1]),
  )
  if (datum_rows.length > 0) {
    return finalize(
      datum_rows.map((row) => row[2]),
      datum_rows.map((row) => row[row.length - 1]),
      `BRML`,
    )
  }
  const list_text =
    doc.querySelector(`Intensities`)?.textContent ?? doc.querySelector(`Counts`)?.textContent
  if (!list_text?.trim()) {
    throw new Error(
      `BRML: RawData XML has neither <Datum> rows nor an <Intensities>/<Counts> list`,
    )
  }
  const values = leading_numbers(list_text)
  const tag_number = (tags: string[]): number | null => {
    for (const tag of tags) {
      const text = doc.querySelector(tag)?.textContent?.trim() ?? ``
      if (NUMBER_RE.test(text)) return Number(text)
    }
    return null
  }
  const start = tag_number([
    `Start`,
    `TwoThetaStart`,
    `StartPosition`,
    `ScanAxisBeginPosition`,
  ])
  const stop = tag_number([`Stop`, `TwoThetaEnd`, `EndPosition`])
  const step =
    tag_number([`Step`, `StepSize`, `Increment`, `ScanAxisIncrement`, `StepWidth`]) ??
    (stop !== null && start !== null && values.length > 1
      ? (stop - start) / (values.length - 1)
      : null)
  const missing = `intensity list without a usable <Start> and <Step> (or <Stop>)`
  return grid_pattern(values, [start, step], `BRML`, missing)
}

// PANalytical .xrdml: <dataPoints> with <positions axis="2Theta"> start/end and a
// space-separated <intensities> list; the grid is uniform between start and end.
export function parse_xrdml_file(content: string): XrdPattern {
  const doc = parse_xml(content, `XRDML`)
  const data_points = doc.querySelector(`dataPoints`)
  if (!data_points) throw new Error(`XRDML: no <dataPoints> element`)
  const positions = data_points.querySelector(`positions[axis="2Theta"]`)
  const start = Number(positions?.querySelector(`startPosition`)?.textContent ?? NaN)
  const end = Number(positions?.querySelector(`endPosition`)?.textContent ?? NaN)
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    throw new TypeError(
      `XRDML: <positions axis="2Theta"> needs numeric startPosition and endPosition`,
    )
  }
  const values = leading_numbers(data_points.querySelector(`intensities`)?.textContent ?? ``)
  if (values.length === 0) throw new Error(`XRDML: empty <intensities>`)
  const step = values.length > 1 ? (end - start) / (values.length - 1) : 0
  return finalize(uniform_grid(start, step, values.length), values, `XRDML`)
}

// Extension → parser. `.gz` is stripped by the caller-facing entry points below.
const TEXT_PARSERS: Record<string, (content: string) => XrdPattern> = {
  xy: parse_xy_file,
  xye: parse_xy_file,
  csv: parse_xy_file,
  dat: parse_ascii_scan,
  asc: parse_ascii_scan,
  txt: parse_ascii_scan,
  ras: parse_ras_file,
  uxd: parse_uxd_file,
  gsas: parse_gsas_file,
  gsa: parse_gsas_file,
  gda: parse_gsas_file,
  fxye: parse_gsas_file,
  xrdml: parse_xrdml_file,
}
const BINARY_PARSERS: Record<string, (data: ArrayBuffer) => XrdPattern | Promise<XrdPattern>> =
  {
    brml: parse_brml_file,
    raw: parse_bruker_raw_file,
  }

// All supported XRD data file extensions (base formats, without .gz)
const XRD_FILE_EXTENSIONS = [
  ...Object.keys(TEXT_PARSERS),
  ...Object.keys(BINARY_PARSERS),
] as const

const base_extension = (filename: string): string =>
  filename.toLowerCase().replace(/\.gz$/, ``).split(`.`).pop() ?? ``

// Check if a filename represents a supported XRD data file format (plain or gzipped)
export const is_xrd_data_file = (filename: string): boolean =>
  XRD_FILE_EXTENSIONS.includes(base_extension(filename))

// Parse an XRD data file by extension. Content must already be decompressed; text parsers
// accept an ArrayBuffer (decoded as UTF-8) and binary parsers accept a string (encoded).
export async function parse_xrd_file(
  content: string | ArrayBuffer,
  filename: string,
): Promise<XrdPattern> {
  const ext = base_extension(filename)
  const text_parser = TEXT_PARSERS[ext]
  if (text_parser) {
    return text_parser(
      typeof content === `string` ? content : new TextDecoder().decode(content),
    )
  }
  const binary_parser = BINARY_PARSERS[ext]
  if (binary_parser) {
    const buffer =
      typeof content === `string` ? new TextEncoder().encode(content).buffer : content
    return binary_parser(buffer)
  }
  throw new Error(
    `Unsupported XRD file extension '.${ext}' (${filename}). Supported: ${XRD_FILE_EXTENSIONS.join(`, `)} (+ .gz)`,
  )
}
