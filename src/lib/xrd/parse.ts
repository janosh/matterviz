import type { XrdPattern } from './index'

// Maximum number of data points to keep after subsampling for performance
const MAX_POINTS = 1000

// Default step size in degrees for XRD scans when not specified in file
const DEFAULT_STEP_SIZE = 0.02

// Generate x values from scan parameters (start angle, step size, point count).
// Used by formats that store metadata + intensity-only data.
function generate_x_from_scan(start: number, step: number, count: number): number[] {
  return Array.from({ length: count }, (_, idx) => start + idx * step)
}

// Create normalized XrdPattern from scan metadata and intensities.
// Returns null if no intensity data. Used by all parsers as final step.
function create_pattern(
  start: number,
  step: number,
  intensities: number[],
): XrdPattern | null {
  if (intensities.length === 0) return null
  const x_values = generate_x_from_scan(start, step, intensities.length)
  const normalized = normalize_and_subsample(x_values, intensities)
  return { x: normalized.x, y: normalized.y }
}

// Parse whitespace-separated numbers from text. Used by multiple formats.
function parse_number_list(text: string): number[] {
  return text.trim().split(/\s+/).map(parseFloat).filter((val) => !isNaN(val))
}

// Extract numeric value from header line matching "KEY=VALUE" or "KEY VALUE" pattern.
// Returns null if not found or not a valid number.
function extract_header_value(
  lines: string[],
  key_pattern: RegExp,
): number | null {
  for (const line of lines) {
    const match = line.match(key_pattern)
    if (match?.[1]) {
      const val = parseFloat(match[1])
      if (!isNaN(val)) return val
    }
  }
  return null
}

// Normalize y values to 0-100 range and subsample if too many points.
// This ensures consistent scaling across different file formats and improves rendering performance.
function normalize_and_subsample(
  x_values: number[],
  y_values: number[],
): { x: number[]; y: number[] } {
  if (x_values.length === 0) return { x: [], y: [] }

  // Normalize y to 0-100
  const max_y = Math.max(...y_values)
  const scale = max_y > 0 ? 100 / max_y : 1
  let norm_y = y_values.map((val) => val * scale)
  let norm_x = x_values

  // Subsample if too many points using LTTB-like algorithm (preserving peaks)
  if (norm_x.length > MAX_POINTS) {
    const result = subsample_preserve_peaks(norm_x, norm_y, MAX_POINTS)
    norm_x = result.x
    norm_y = result.y
  }

  return { x: norm_x, y: norm_y }
}

// Subsample data while preserving peaks (local maxima).
// Uses a combination of uniform sampling and peak preservation.
function subsample_preserve_peaks(
  x_values: number[],
  y_values: number[],
  target_points: number,
): { x: number[]; y: number[] } {
  const num_points = x_values.length
  if (num_points <= target_points) return { x: x_values, y: y_values }

  // Find peaks (local maxima with significant height)
  const peaks: number[] = []
  const threshold = Math.max(...y_values) * 0.05 // 5% of max as significance threshold
  for (let idx = 1; idx < num_points - 1; idx++) {
    if (
      y_values[idx] > y_values[idx - 1] &&
      y_values[idx] > y_values[idx + 1] &&
      y_values[idx] > threshold
    ) {
      peaks.push(idx)
    }
  }

  // Reserve slots for peaks, distribute remaining uniformly
  const peak_slots = Math.min(peaks.length, Math.floor(target_points * 0.3))
  const uniform_slots = target_points - peak_slots

  // Select top peaks by height
  const top_peaks = peaks
    .map((idx) => ({ idx, y: y_values[idx] }))
    .sort((a, b) => b.y - a.y)
    .slice(0, peak_slots)
    .map((p) => p.idx)

  // Uniform sampling (guard against division by zero)
  const uniform_indices = new Set<number>()
  if (uniform_slots > 1) {
    const step = (num_points - 1) / (uniform_slots - 1)
    for (let idx = 0; idx < uniform_slots; idx++) {
      uniform_indices.add(Math.round(idx * step))
    }
  } else if (uniform_slots === 1) {
    uniform_indices.add(0) // Just include the first point
  }

  // Merge and sort all selected indices
  const selected = [...new Set([...uniform_indices, ...top_peaks])].sort(
    (a, b) => a - b,
  )

  return {
    x: selected.map((idx) => x_values[idx]),
    y: selected.map((idx) => y_values[idx]),
  }
}

// Parse a two-column ASCII file containing XRD data (2θ, intensity).
// Supports space, tab, or comma delimiters. Ignores comment lines starting with #, ;, or !
// Also handles .xye (third error column ignored), .csv, .dat, .asc formats.
export function parse_xy_file(content: string): XrdPattern | null {
  const lines = content.split(/\r?\n/)
  const x_values: number[] = []
  const y_values: number[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    // Skip empty lines and common comment prefixes
    if (!trimmed || /^[#;!]/.test(trimmed)) continue

    // Split by whitespace or comma
    const parts = trimmed.split(/[\s,]+/).filter(Boolean)
    if (parts.length < 2) continue

    const two_theta = parseFloat(parts[0])
    const intensity = parseFloat(parts[1])

    if (!isNaN(two_theta) && !isNaN(intensity)) {
      x_values.push(two_theta)
      y_values.push(intensity)
    }
  }

  if (x_values.length === 0) return null

  const normalized = normalize_and_subsample(x_values, y_values)
  return { x: normalized.x, y: normalized.y }
}

// Parse a .xye file containing three-column XRD data (2θ, intensity, error).
// Same as .xy but with an optional third column for uncertainties (ignored for plotting).
export function parse_xye_file(content: string): XrdPattern | null {
  // XYE is just XY with an extra error column - reuse parse_xy_file which already
  // handles extra columns by only taking the first two
  return parse_xy_file(content)
}

// Parse a Rigaku .ras file (ASCII format with structured header).
// Format: *RAS_HEADER_START ... *RAS_HEADER_END followed by *RAS_INT_START ... *RAS_INT_END
// Data can be single-column (intensity only) or multi-column (2-theta, intensity, [error])
export function parse_ras_file(content: string): XrdPattern | null {
  const lines = content.split(/\r?\n/)

  // Extract header values (used as fallback for single-column data)
  const header_start =
    extract_header_value(lines, /\*MEAS_SCAN_START\s*=\s*([\d.+-]+)/i) ??
      extract_header_value(lines, /\*SCAN_START\s*=\s*([\d.+-]+)/i) ??
      0
  const header_step = extract_header_value(lines, /\*MEAS_SCAN_STEP\s*=\s*([\d.+-]+)/i) ??
    extract_header_value(lines, /\*SCAN_STEP\s*=\s*([\d.+-]+)/i) ??
    DEFAULT_STEP_SIZE

  // Find intensity data section between *RAS_INT_START and *RAS_INT_END
  // Also handle older format with *RAS_DATA_START
  let in_data_section = false
  const data_lines: string[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (/^\*RAS_INT_START/i.test(trimmed) || /^\*RAS_DATA_START/i.test(trimmed)) {
      in_data_section = true
      continue
    }
    if (/^\*RAS_INT_END/i.test(trimmed) || /^\*RAS_DATA_END/i.test(trimmed)) break
    if (in_data_section && trimmed) data_lines.push(trimmed)
  }

  // Fallback: if no section markers, try parsing all numeric lines after header
  if (data_lines.length === 0) {
    let past_header = false
    for (const line of lines) {
      const trimmed = line.trim()
      if (/^\*RAS_HEADER_END/i.test(trimmed)) {
        past_header = true
        continue
      }
      if (past_header && trimmed && !trimmed.startsWith(`*`)) {
        const values = parse_number_list(trimmed)
        if (values.length > 0) data_lines.push(trimmed)
      }
    }
  }

  if (data_lines.length === 0) return null

  // Multi-column (2-theta, intensity, [error]): reuse parse_xy_file
  // Detect by: 2-3 values per line, multiple rows, first column monotonically increasing
  // (angles increase during a scan, intensities do not follow this pattern)
  const first_values = parse_number_list(data_lines[0])
  const has_column_structure = first_values.length >= 2 && first_values.length <= 3 &&
    data_lines.length > 1

  if (has_column_structure) {
    // Check if first column values are monotonically increasing (characteristic of angle data)
    // Sample a few lines to verify the pattern
    const sample_count = Math.min(5, data_lines.length)
    let is_monotonic = true
    let prev_angle = first_values[0]

    for (let idx = 1; idx < sample_count; idx++) {
      const values = parse_number_list(data_lines[idx])
      if (values.length < 2 || values[0] <= prev_angle) {
        is_monotonic = false
        break
      }
      prev_angle = values[0]
    }

    if (is_monotonic) return parse_xy_file(data_lines.join(`\n`))
  }

  // Single-column or many space-separated intensities: use header start/step
  const intensities = data_lines.flatMap(parse_number_list)
  return create_pattern(header_start, header_step, intensities)
}

// Parse a Siemens/Bruker .uxd file (ASCII format with underscore-prefixed header).
// Format: _KEY=VALUE or _KEY VALUE header lines, followed by _COUNTS section.
export function parse_uxd_file(content: string): XrdPattern | null {
  const lines = content.split(/\r?\n/)

  // Extract header values (underscore-prefixed keys)
  const start = extract_header_value(lines, /_2THETA_?START\s*=?\s*([\d.+-]+)/i) ??
    extract_header_value(lines, /_START\s*=?\s*([\d.+-]+)/i) ??
    0
  const step = extract_header_value(lines, /_STEP_?SIZE\s*=?\s*([\d.+-]+)/i) ??
    extract_header_value(lines, /_STEPWIDTH\s*=?\s*([\d.+-]+)/i) ??
    DEFAULT_STEP_SIZE

  // Find intensity data after _COUNTS marker
  let in_data_section = false
  const intensities: number[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    // Skip comments
    if (trimmed.startsWith(`;`)) continue

    if (/^_COUNTS/i.test(trimmed)) {
      in_data_section = true
      continue
    }
    // New header section ends data
    if (in_data_section && trimmed.startsWith(`_`)) {
      break
    }
    if (in_data_section && trimmed) {
      const values = parse_number_list(trimmed)
      intensities.push(...values)
    }
  }

  // Fallback: if no _COUNTS marker, try two-column format
  if (intensities.length === 0) return parse_xy_file(content)

  return create_pattern(start, step, intensities)
}

// Parse a GSAS powder diffraction file.
// Handles both STD (constant step) and ESD (explicit positions) formats.
// BANK header contains metadata: BANK n NPTS NCHAN BINTYPE BCOEF1 BCOEF2 ...
export function parse_gsas_file(content: string): XrdPattern | null {
  const lines = content.split(/\r?\n/)

  // Find BANK header line (format varies by GSAS version)
  let start = 0
  let step = DEFAULT_STEP_SIZE
  let bin_type = `CONST` // CONST, RALF, or others
  let found_bank = false

  for (const line of lines) {
    const bank_match = line.match(
      /BANK\s+\d+\s+(\d+)\s+\d+\s+(\w+)\s+([\d.+-]+)\s+([\d.+-]+)/i,
    )
    if (bank_match) {
      bin_type = bank_match[2].toUpperCase()
      // For CONST type: BCOEF1 is start*100 (centidegrees), BCOEF2 is step*100
      if (bin_type === `CONST`) {
        start = parseFloat(bank_match[3]) / 100 // Convert centidegrees to degrees
        step = parseFloat(bank_match[4]) / 100
      } else if (bin_type !== `FXYE`) {
        // Other bin types like RALF (time-of-flight) are not fully supported
        console.warn(
          `GSAS bin type "${bin_type}" not fully supported, treating as constant-step`,
        )
      }
      found_bank = true
      break
    }
  }

  // Collect intensity values after BANK header
  const intensities: number[] = []
  const is_fxye = bin_type === `FXYE` // Only use triplet parsing if BANK explicitly says FXYE
  let past_bank = !found_bank // If no BANK header, try parsing all data

  for (const line of lines) {
    if (line.includes(`BANK`)) {
      past_bank = true
      continue
    }
    // Skip header/title lines
    if (!past_bank || line.startsWith(`#`) || line.startsWith(`!`)) continue
    const trimmed = line.trim()
    if (!trimmed) continue

    // GSAS uses fixed-width columns or space-separated values
    const values = parse_number_list(trimmed)
    // For FXYE format (x, y, e triplets), extract y values at indices 1, 4, 7, ...
    if (is_fxye && values.length >= 3) {
      for (let idx = 1; idx < values.length; idx += 3) {
        intensities.push(values[idx])
      }
    } else {
      intensities.push(...values)
    }
  }

  return create_pattern(start, step, intensities)
}

// Bruker RAW V2 header byte offsets (little-endian)
const RAW_V2_HEADER_SIZE_OFFSET = 4
const RAW_V2_START_OFFSET = 48
const RAW_V2_STEP_OFFSET = 56
const RAW_V2_COUNT_OFFSET = 64

// Bruker RAW V4 header byte offsets (little-endian)
const RAW_V4_HEADER_SIZE_OFFSET = 4
const RAW_V4_START_OFFSET = 140
const RAW_V4_STEP_OFFSET = 148
const RAW_V4_COUNT_OFFSET = 156
// Alternative V4 offsets for some instrument variants
const RAW_V4_ALT_START_OFFSET = 76
const RAW_V4_ALT_STEP_OFFSET = 84
const RAW_V4_ALT_COUNT_OFFSET = 92

// Parse a Bruker binary .raw file.
// Detects format version from magic bytes and extracts scan parameters + intensities.
export function parse_bruker_raw_file(data: ArrayBuffer): XrdPattern | null {
  const view = new DataView(data)
  const bytes = new Uint8Array(data)

  // Check magic bytes to determine version
  const magic = String.fromCharCode(...bytes.slice(0, 4))

  // RAW1.01 format (older)
  if (magic === `RAW1` || magic === `RAW `) {
    return parse_bruker_raw_v1(view, bytes)
  }
  // RAW2.00 format
  if (magic === `RAW2`) {
    return parse_bruker_raw_v2(view)
  }
  // RAW4 format (newer)
  if (magic === `RAW4`) {
    return parse_bruker_raw_v4(view)
  }

  // Try Rigaku RAW format (different structure)
  // Rigaku files often start with different magic or have no magic
  return parse_rigaku_raw_file(data)
}

// Parse Bruker RAW version 1 format
function parse_bruker_raw_v1(view: DataView, bytes: Uint8Array): XrdPattern | null {
  try {
    // V1 has ASCII header with scan parameters followed by binary data
    const header_text = String.fromCharCode(...bytes.slice(0, 512))

    // Try to find scan parameters in ASCII header
    const start_match = header_text.match(/START\s*=\s*([\d.+-]+)/i)
    const step_match = header_text.match(/STEP\s*=\s*([\d.+-]+)/i)
    const count_match = header_text.match(/(?:COUNT|POINTS|NPTS)\s*=\s*(\d+)/i)

    const start = start_match ? parseFloat(start_match[1]) : 0
    const step = step_match ? parseFloat(step_match[1]) : DEFAULT_STEP_SIZE

    // Find where binary data starts (after header)
    let data_offset = 512
    if (count_match) {
      const expected_count = parseInt(count_match[1])
      // Binary data is typically 4 bytes per intensity (float32)
      data_offset = bytes.length - expected_count * 4
    }

    const intensities = read_float32_array(view, data_offset)
    return create_pattern(start, step, intensities)
  } catch {
    return null
  }
}

// Parse Bruker RAW version 2 format
function parse_bruker_raw_v2(view: DataView): XrdPattern | null {
  try {
    const header_size = view.getUint32(RAW_V2_HEADER_SIZE_OFFSET, true)
    const start = view.getFloat64(RAW_V2_START_OFFSET, true)
    const step = view.getFloat64(RAW_V2_STEP_OFFSET, true)
    const count = view.getUint32(RAW_V2_COUNT_OFFSET, true)

    if (count === 0 || step <= 0) return null

    const intensities = read_float32_array(view, header_size, count)
    return create_pattern(start, step, intensities)
  } catch {
    return null
  }
}

// Parse Bruker RAW version 4 format
function parse_bruker_raw_v4(view: DataView): XrdPattern | null {
  try {
    const header_size = view.getUint32(RAW_V4_HEADER_SIZE_OFFSET, true)
    let start = view.getFloat64(RAW_V4_START_OFFSET, true)
    let step = view.getFloat64(RAW_V4_STEP_OFFSET, true)
    let count = view.getUint32(RAW_V4_COUNT_OFFSET, true)

    // Try alternative offsets for different V4 variants
    if (count === 0 || step <= 0 || isNaN(start)) {
      start = view.getFloat64(RAW_V4_ALT_START_OFFSET, true)
      step = view.getFloat64(RAW_V4_ALT_STEP_OFFSET, true)
      count = view.getUint32(RAW_V4_ALT_COUNT_OFFSET, true)
      if (count === 0 || step <= 0 || isNaN(start)) return null
    }

    const intensities = read_float32_array(view, header_size, count)
    return create_pattern(start, step, intensities)
  } catch {
    return null
  }
}

// Parse Rigaku binary .raw file format
function parse_rigaku_raw_file(data: ArrayBuffer): XrdPattern | null {
  try {
    const view = new DataView(data)
    const bytes = new Uint8Array(data)

    // Try to find ASCII header section with scan parameters
    const header_text = String.fromCharCode(
      ...bytes.slice(0, Math.min(2048, bytes.length)),
    )

    const start_match = header_text.match(
      /(?:START|2THETA_START|SCAN_START)\s*[:=]?\s*([\d.+-]+)/i,
    )
    const step_match = header_text.match(
      /(?:STEP|STEP_SIZE|SCAN_STEP)\s*[:=]?\s*([\d.+-]+)/i,
    )
    const count_match = header_text.match(/(?:COUNT|POINTS|NPTS|STEPS)\s*[:=]?\s*(\d+)/i)

    if (!start_match && !step_match && !count_match) return null // Not a recognizable Rigaku format

    const start = start_match ? parseFloat(start_match[1]) : 0
    const step = step_match ? parseFloat(step_match[1]) : DEFAULT_STEP_SIZE
    const expected_count = count_match ? parseInt(count_match[1]) : 0

    // Find binary data section
    // Rigaku typically stores intensities as 32-bit floats or integers
    let data_offset = 0
    for (let offset = 256; offset < Math.min(4096, bytes.length); offset += 4) {
      // Look for start of reasonable intensity values
      const val = view.getFloat32(offset, true)
      if (val >= 0 && val < 1e10 && !isNaN(val)) {
        data_offset = offset
        break
      }
    }

    const intensities = read_float32_array(view, data_offset, expected_count || undefined)
    return create_pattern(start, step, intensities)
  } catch {
    return null
  }
}

// Read array of 32-bit floats from DataView starting at offset.
// Note: Negative values are allowed since background-subtracted XRD data can
// legitimately have negative intensities.
function read_float32_array(
  view: DataView,
  offset: number,
  count?: number,
): number[] {
  const values: number[] = []
  const max_offset = view.byteLength - 4
  const max_count = count ?? Math.floor((view.byteLength - offset) / 4)

  // Track invalid values in the first N points to detect wrong offset.
  // Trade-off: This heuristic may reject legitimate data with corrupted initial
  // measurements, but such cases are rare. If >50% of the first 20 values are
  // invalid (NaN/Infinity), we assume the offset is incorrect and return early.
  const EARLY_CHECK_COUNT = 20
  const INVALID_THRESHOLD = 0.5
  let invalid_count = 0

  for (let idx = 0; idx < max_count && offset + idx * 4 <= max_offset; idx++) {
    const val = view.getFloat32(offset + idx * 4, true) // little-endian
    // Filter out invalid values (NaN, Infinity)
    if (isNaN(val) || !isFinite(val)) {
      if (idx < EARLY_CHECK_COUNT) {
        invalid_count++
        if (invalid_count > EARLY_CHECK_COUNT * INVALID_THRESHOLD) break
      }
      values.push(0) // Replace isolated bad values
    } else values.push(val)
  }

  return values
}

// Parse a Bruker .brml file (ZIP archive containing XML data).
// Extracts 2θ and intensity data from the RawData XML within the archive.
export async function parse_brml_file(data: ArrayBuffer): Promise<XrdPattern | null> {
  try {
    // Lazy import fflate to avoid bundling in SSR (Deno compatibility)
    const { unzipSync } = await import(`fflate`)
    const files = unzipSync(new Uint8Array(data))

    // Find the RawData XML file (usually named RawData0.xml or similar)
    let raw_data_xml: string | null = null
    for (const [filename, file_data] of Object.entries(files)) {
      if (filename.toLowerCase().includes(`rawdata`) && filename.endsWith(`.xml`)) {
        raw_data_xml = new TextDecoder().decode(file_data)
        break
      }
    }

    // If no RawData file found, try to find any XML file with intensity data
    if (!raw_data_xml) {
      for (const [filename, file_data] of Object.entries(files)) {
        if (filename.endsWith(`.xml`)) {
          const file_content = new TextDecoder().decode(file_data)
          // Check for various data formats used by different Bruker versions
          if (
            [`<Intensities>`, `<Counts>`, `<Datum>`].some((tag) =>
              file_content.includes(tag)
            )
          ) {
            raw_data_xml = file_content
            break
          }
        }
      }
    }

    if (!raw_data_xml) return null

    return parse_brml_xml(raw_data_xml)
  } catch (error) {
    console.error(`Failed to parse BRML file:`, error)
    return null
  }
}

// Parse the XML content from a BRML file to extract XRD data.
// Bruker BRML files contain scan parameters and intensity counts.
function parse_brml_xml(xml_content: string): XrdPattern | null {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(xml_content, `application/xml`)

    // Check for parsing errors
    const parse_error = doc.querySelector(`parsererror`)
    if (parse_error) return null

    // Extract scan parameters - try multiple possible structures
    // Bruker BRML files can have different XML schemas
    const scan_info = extract_scan_parameters_xml(doc)
    if (!scan_info) return null

    const { start_angle, step_size, intensities } = scan_info
    return create_pattern(start_angle, step_size, intensities)
  } catch (error) {
    console.error(`Failed to parse BRML XML:`, error)
    return null
  }
}

// Extract scan parameters and intensities from BRML XML document.
// Handles multiple possible XML structures used by different Bruker versions.
function extract_scan_parameters_xml(
  doc: Document,
): { start_angle: number; step_size: number; intensities: number[] } | null {
  // Try to find intensity data - multiple possible tag names
  let intensities: number[] | null = null
  let two_theta_values: number[] | null = null

  // Method 1: <Intensities> tag with space-separated values
  const intensities_el = doc.querySelector(`Intensities`)
  if (intensities_el?.textContent) {
    intensities = parse_number_list(intensities_el.textContent)
  }

  // Method 2: <Counts> tag
  if (!intensities?.length) {
    const counts_el = doc.querySelector(`Counts`)
    if (counts_el?.textContent) {
      intensities = parse_number_list(counts_el.textContent)
    }
  }

  // Method 3: Individual <I> or <Count> elements
  if (!intensities?.length) {
    const intensity_elements = doc.querySelectorAll(`I, Count`)
    if (intensity_elements.length > 0) {
      intensities = Array.from(intensity_elements)
        .map((el) => parseFloat(el.textContent || ``))
        .filter((val) => !isNaN(val))
    }
  }

  // Method 4: <Datum> elements with comma-separated values
  // Bruker uses different formats depending on instrument/software version:
  // - 8-column HRXRD: "1,1,TwoTheta,Omega,...,Intensity" (indices 2 and 7)
  // - 5-column powder: "time,1,TwoTheta,Theta,Intensity" (indices 2 and 4)
  // The intensity is always the LAST column, 2Theta is always index 2
  if (!intensities?.length) {
    const datum_elements = Array.from(doc.querySelectorAll(`Datum`))
    if (datum_elements.length > 0) {
      two_theta_values = []
      intensities = []
      for (const datum of datum_elements) {
        const text = datum.textContent?.trim()
        if (!text) continue
        const parts = text.split(`,`)
        // Need at least 5 columns: time, flag, 2Theta, Theta/Omega, Intensity
        if (parts.length >= 5) {
          const two_theta = parseFloat(parts[2])
          // Intensity is always the last column
          const intensity = parseFloat(parts[parts.length - 1])
          if (!isNaN(two_theta) && !isNaN(intensity)) {
            two_theta_values.push(two_theta)
            intensities.push(intensity)
          }
        }
      }
      // If we have extracted 2θ values directly, return early with them
      if (two_theta_values.length > 0 && intensities.length > 0) {
        // Calculate step size from actual data (fallback 0.002° typical for HRXRD)
        const step_size = two_theta_values.length > 1
          ? (two_theta_values[two_theta_values.length - 1] - two_theta_values[0]) /
            (two_theta_values.length - 1)
          : DEFAULT_STEP_SIZE
        return { start_angle: two_theta_values[0], step_size, intensities }
      }
    }
  }

  if (!intensities?.length) return null

  // Extract scan range parameters
  let start_angle = 0
  let step_size = DEFAULT_STEP_SIZE

  // Try to find start angle - multiple possible locations
  const start_candidates = [
    `Start`,
    `TwoThetaStart`,
    `StartPosition`,
    `2ThetaBegin`,
    `ScanAxisBeginPosition`,
    `Begin`,
  ]
  for (const tag of start_candidates) {
    const el = doc.querySelector(tag)
    if (el?.textContent) {
      const val = parseFloat(el.textContent)
      if (!isNaN(val)) {
        start_angle = val
        break
      }
    }
  }

  // Try to find step size - multiple possible locations
  const step_candidates = [
    `Step`,
    `StepSize`,
    `Increment`,
    `2ThetaIncrement`,
    `ScanAxisIncrement`,
    `StepWidth`,
  ]
  for (const tag of step_candidates) {
    const el = doc.querySelector(tag)
    if (el?.textContent) {
      const val = parseFloat(el.textContent)
      if (!isNaN(val) && val > 0) {
        step_size = val
        break
      }
    }
  }

  // Alternative: calculate step from start/end and count
  if (step_size === DEFAULT_STEP_SIZE) {
    const end_candidates = [`Stop`, `TwoThetaEnd`, `EndPosition`, `2ThetaEnd`, `End`]
    for (const tag of end_candidates) {
      const el = doc.querySelector(tag)
      if (el?.textContent) {
        const end_val = parseFloat(el.textContent)
        if (!isNaN(end_val) && end_val > start_angle && intensities.length > 1) {
          step_size = (end_val - start_angle) / (intensities.length - 1)
          break
        }
      }
    }
  }

  return { start_angle, step_size, intensities }
}

// Parse a PANalytical .xrdml file (XML format).
// Extracts 2θ range and intensities from the XML structure.
export function parse_xrdml_file(content: string): XrdPattern | null {
  try {
    const parser = new DOMParser()
    const doc = parser.parseFromString(content, `application/xml`)

    // Check for parsing errors
    const parse_error = doc.querySelector(`parsererror`)
    if (parse_error) return null

    // Find dataPoints section
    const data_points = doc.querySelector(`dataPoints`)
    if (!data_points) return null

    // Extract 2θ positions (start and end)
    const two_theta_positions = data_points.querySelector(`positions[axis="2Theta"]`)
    if (!two_theta_positions) return null

    const start_el = two_theta_positions.querySelector(`startPosition`)
    const end_el = two_theta_positions.querySelector(`endPosition`)
    if (!start_el?.textContent || !end_el?.textContent) return null

    const start_angle = parseFloat(start_el.textContent)
    const end_angle = parseFloat(end_el.textContent)
    if (isNaN(start_angle) || isNaN(end_angle)) return null

    // Extract intensities
    const intensities_el = data_points.querySelector(`intensities`)
    if (!intensities_el?.textContent) return null

    const intensities = parse_number_list(intensities_el.textContent)
    const step = intensities.length > 1
      ? (end_angle - start_angle) / (intensities.length - 1)
      : DEFAULT_STEP_SIZE
    return create_pattern(start_angle, step, intensities)
  } catch (error) {
    console.error(`Failed to parse XRDML file:`, error)
    return null
  }
}

// Two-column ASCII format extensions (all use parse_xy_file)
const ASCII_XY_EXTENSIONS = [`xy`, `xye`, `csv`, `dat`, `asc`, `txt`] as const

// Header-based ASCII format extensions
const GSAS_EXTENSIONS = [`gsas`, `gsa`, `gda`, `fxye`] as const
const ASCII_HEADER_EXTENSIONS = [`ras`, `uxd`, ...GSAS_EXTENSIONS] as const

// XML-based format extensions
const XML_EXTENSIONS = [`xrdml`] as const

// Binary format extensions
const BINARY_EXTENSIONS = [`brml`, `raw`] as const

// All supported XRD data file extensions (base formats, without .gz)
export const XRD_FILE_EXTENSIONS = [
  ...ASCII_XY_EXTENSIONS,
  ...ASCII_HEADER_EXTENSIONS,
  ...XML_EXTENSIONS,
  ...BINARY_EXTENSIONS,
] as const

export type XrdFileExtension = typeof XRD_FILE_EXTENSIONS[number]

// Main entry point for parsing XRD data files.
// Detects file type by extension and delegates to appropriate parser.
// Handles both plain and gzipped filenames (content should already be decompressed)
export async function parse_xrd_file(
  content: string | ArrayBuffer,
  filename: string,
): Promise<XrdPattern | null> {
  // Strip .gz suffix if present to get base extension
  const base_name = filename.toLowerCase().replace(/\.gz$/, ``)
  const ext = base_name.split(`.`).pop() as XrdFileExtension | undefined

  if (!ext) return null

  // Helper to get text content
  const get_text = (): string =>
    typeof content === `string`
      ? content
      : new TextDecoder().decode(content as BufferSource)

  // Helper to get binary content
  const get_buffer = (): ArrayBuffer => {
    if (typeof content === `string`) {
      const encoded = new TextEncoder().encode(content)
      // Create a new ArrayBuffer and copy the data to avoid SharedArrayBuffer type issues
      const buffer = new ArrayBuffer(encoded.byteLength)
      new Uint8Array(buffer).set(encoded)
      return buffer
    }
    return content as ArrayBuffer
  }

  // Two-column ASCII formats
  if ((ASCII_XY_EXTENSIONS as readonly string[]).includes(ext)) {
    return parse_xy_file(get_text())
  }

  // Header-based ASCII formats
  if (ext === `ras`) return parse_ras_file(get_text())
  if (ext === `uxd`) return parse_uxd_file(get_text())
  if ((GSAS_EXTENSIONS as readonly string[]).includes(ext)) {
    return parse_gsas_file(get_text())
  }

  // XML formats
  if (ext === `xrdml`) return parse_xrdml_file(get_text())

  // Binary formats
  if (ext === `brml`) return await parse_brml_file(get_buffer()) // async due to lazy fflate import
  if (ext === `raw`) return parse_bruker_raw_file(get_buffer())

  return null
}

// Check if a filename represents a supported XRD data file format.
// Recognizes both plain and gzipped versions (e.g. .xy and .xy.gz)
export function is_xrd_data_file(filename: string): boolean {
  // Strip .gz suffix if present to get base extension
  const base_name = filename.toLowerCase().replace(/\.gz$/, ``)
  const ext = base_name.split(`.`).pop()
  return ext !== undefined && (XRD_FILE_EXTENSIONS as readonly string[]).includes(ext)
}
