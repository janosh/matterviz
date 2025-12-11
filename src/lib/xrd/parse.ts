import { unzipSync } from 'fflate'
import type { XrdPattern } from './index'

// Maximum number of data points to keep after subsampling for performance
const MAX_POINTS = 1000

// Default step size in degrees for XRD scans when not specified in file
const DEFAULT_STEP_SIZE = 0.02

// Normalize y values to 0-100 range and subsample if too many points.
// This ensures consistent scaling across different file formats and improves rendering performance.
function normalize_and_subsample(
  x_values: number[],
  y_values: number[],
): { x: number[]; y: number[] } { // Object with normalized x and y values
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

// Parse a .xy file containing two-column XRD data (2θ, intensity).
// Supports space, tab, or comma delimiters. Ignores comment lines starting with #.
export function parse_xy_file(content: string): XrdPattern | null {
  const lines = content.split(/\r?\n/)
  const x_values: number[] = []
  const y_values: number[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith(`#`)) continue

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

// Parse a Bruker .brml file (ZIP archive containing XML data).
// Extracts 2θ and intensity data from the RawData XML within the archive.
export function parse_brml_file(data: ArrayBuffer): XrdPattern | null {
  try {
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
          const content = new TextDecoder().decode(file_data)
          // Check for various data formats used by different Bruker versions
          if (
            [`<Intensities>`, `<Counts>`, `<Datum>`].some((tag) => content.includes(tag))
          ) {
            raw_data_xml = content
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
    const scan_info = extract_scan_parameters(doc)
    if (!scan_info) return null

    const { start_angle, step_size, intensities } = scan_info

    // Generate 2θ values from scan parameters
    const x_values: number[] = []
    for (let idx = 0; idx < intensities.length; idx++) {
      x_values.push(start_angle + idx * step_size)
    }

    const normalized = normalize_and_subsample(x_values, intensities)
    return { x: normalized.x, y: normalized.y }
  } catch (error) {
    console.error(`Failed to parse BRML XML:`, error)
    return null
  }
}

// Extract scan parameters and intensities from BRML XML document.
// Handles multiple possible XML structures used by different Bruker versions.
function extract_scan_parameters(
  doc: Document,
): { start_angle: number; step_size: number; intensities: number[] } | null {
  // Try to find intensity data - multiple possible tag names
  let intensities: number[] | null = null
  let two_theta_values: number[] | null = null

  // Method 1: <Intensities> tag with space-separated values
  const intensities_el = doc.querySelector(`Intensities`)
  if (intensities_el?.textContent) {
    intensities = intensities_el.textContent
      .trim()
      .split(/\s+/)
      .map((val) => parseFloat(val))
      .filter((val) => !isNaN(val))
  }

  // Method 2: <Counts> tag
  if (!intensities?.length) {
    const counts_el = doc.querySelector(`Counts`)
    if (counts_el?.textContent) {
      intensities = counts_el.textContent
        .trim()
        .split(/\s+/)
        .map((val) => parseFloat(val))
        .filter((val) => !isNaN(val))
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

// Parse a .xye file containing three-column XRD data (2θ, intensity, error).
// Same as .xy but with an optional third column for uncertainties (ignored for plotting).
export function parse_xye_file(content: string): XrdPattern | null {
  // XYE is just XY with an extra error column - reuse parse_xy_file which already
  // handles extra columns by only taking the first two
  return parse_xy_file(content)
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

    const intensities = intensities_el.textContent
      .trim()
      .split(/\s+/)
      .map((val) => parseFloat(val))
      .filter((val) => !isNaN(val))

    if (intensities.length === 0) return null

    // Generate 2θ values from start/end and count
    const x_values: number[] = []
    const step = intensities.length > 1
      ? (end_angle - start_angle) / (intensities.length - 1)
      : DEFAULT_STEP_SIZE
    for (let idx = 0; idx < intensities.length; idx++) {
      x_values.push(start_angle + idx * step)
    }

    const normalized = normalize_and_subsample(x_values, intensities)
    return { x: normalized.x, y: normalized.y }
  } catch (error) {
    console.error(`Failed to parse XRDML file:`, error)
    return null
  }
}

// Main entry point for parsing XRD data files.
// Detects file type by extension and delegates to appropriate parser.
export function parse_xrd_file(
  content: string | ArrayBuffer,
  filename: string,
): XrdPattern | null {
  const ext = filename.toLowerCase().split(`.`).pop()

  // Text-based formats
  if (ext === `xy` || ext === `xye`) {
    const text = typeof content === `string`
      ? content
      : new TextDecoder().decode(content as BufferSource)
    return ext === `xye` ? parse_xye_file(text) : parse_xy_file(text)
  }

  if (ext === `xrdml`) {
    const text = typeof content === `string`
      ? content
      : new TextDecoder().decode(content as BufferSource)
    return parse_xrdml_file(text)
  }

  // Binary formats
  if (ext === `brml`) {
    const buffer = typeof content === `string`
      ? new TextEncoder().encode(content).buffer
      : content
    return parse_brml_file(buffer as ArrayBuffer)
  }

  return null
}

// Supported XRD data file extensions
export const XRD_FILE_EXTENSIONS = [`xy`, `xye`, `xrdml`, `brml`] as const

// Check if a filename represents a supported XRD data file format.
export function is_xrd_data_file(filename: string): boolean {
  const ext = filename.toLowerCase().split(`.`).pop()
  return XRD_FILE_EXTENSIONS.includes(ext as typeof XRD_FILE_EXTENSIONS[number])
}
