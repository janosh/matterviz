import {
  is_xrd_data_file,
  parse_brml_file,
  parse_bruker_raw_file,
  parse_gsas_file,
  parse_ras_file,
  parse_uxd_file,
  parse_xrd_file,
  parse_xrdml_file,
  parse_xy_file,
  parse_xye_file,
} from '$lib/xrd/parse'
import { zipSync } from 'fflate'
import { Buffer } from 'node:buffer'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { describe, expect, test } from 'vitest'

describe(`parse_xy_file`, () => {
  // Note: parse_xy_file normalizes y values to 0-100 range
  test.each([
    [`space-separated`, `10.0 100\n20.0 200\n30.0 300`],
    [`tab-separated`, `10.0\t100\n20.0\t200\n30.0\t300`],
    [`comma-separated`, `10.0,100\n20.0,200\n30.0,300`],
    [`mixed whitespace`, `10.0  100\n20.0\t\t200\n30.0   300`],
  ])(`parses %s data correctly`, (_name, content) => {
    const result = parse_xy_file(content)
    expect(result).not.toBeNull()
    expect(result?.x).toEqual([10, 20, 30])
    // y values are normalized: 100/300*100=33.33, 200/300*100=66.67, 300/300*100=100
    expect(result?.y[0]).toBeCloseTo(33.33, 1)
    expect(result?.y[1]).toBeCloseTo(66.67, 1)
    expect(result?.y[2]).toBeCloseTo(100, 1)
  })

  test(`ignores comment lines starting with #`, () => {
    const content = `# This is a comment\n10.0 100\n# Another comment\n20.0 200`
    const result = parse_xy_file(content)
    expect(result).not.toBeNull()
    expect(result?.x).toEqual([10, 20])
    // Normalized: 100/200*100=50, 200/200*100=100
    expect(result?.y[0]).toBeCloseTo(50, 1)
    expect(result?.y[1]).toBeCloseTo(100, 1)
  })

  test(`handles empty lines gracefully`, () => {
    const content = `10.0 100\n\n20.0 200\n\n\n30.0 300`
    const result = parse_xy_file(content)
    expect(result).not.toBeNull()
    expect(result?.x).toEqual([10, 20, 30])
    expect(result?.y[2]).toBeCloseTo(100, 1)
  })

  test(`handles Windows-style line endings (CRLF)`, () => {
    const content = `10.0 100\r\n20.0 200\r\n30.0 300`
    const result = parse_xy_file(content)
    expect(result).not.toBeNull()
    expect(result?.x).toEqual([10, 20, 30])
    expect(result?.y[2]).toBeCloseTo(100, 1) // max normalized to 100
  })

  test.each([
    [`empty content`, ``],
    [`only comments`, `# comment 1\n# comment 2`],
  ])(`returns null for %s`, (_desc, content) => {
    expect(parse_xy_file(content)).toBeNull()
  })

  test.each([
    [`insufficient columns`, `10.0 100\n20.0\n30.0 300`],
    [`non-numeric values`, `10.0 100\nabc def\n30.0 300`],
  ])(`skips invalid lines (%s)`, (_desc, content) => {
    const result = parse_xy_file(content)
    expect(result).not.toBeNull()
    expect(result?.x).toEqual([10, 30])
  })

  test(`handles scientific notation`, () => {
    const content = `10.0 1e3\n20.0 2.5e-2\n30.0 3E4`
    const result = parse_xy_file(content)
    expect(result).not.toBeNull()
    expect(result?.x).toEqual([10, 20, 30])
    // Max is 3E4=30000, so normalized: 1000/30000*100=3.33, 0.025/30000*100≈0, 30000/30000*100=100
    expect(result?.y[0]).toBeCloseTo(3.33, 1)
    expect(result?.y[1]).toBeCloseTo(0, 3)
    expect(result?.y[2]).toBeCloseTo(100, 1)
  })

  test(`handles all-zero intensities without division by zero`, () => {
    const content = `10.0 0\n20.0 0\n30.0 0`
    const result = parse_xy_file(content)
    expect(result).not.toBeNull()
    expect(result?.y).toEqual([0, 0, 0])
  })

  test(`subsamples large datasets without division by zero`, () => {
    // Generate 2000 points (above MAX_POINTS=1000) with many peaks to stress uniform_slots
    const lines: string[] = []
    for (let idx = 0; idx < 2000; idx++) {
      const x = 10 + idx * 0.05
      // Create alternating high/low pattern to maximize peak detection
      const y = idx % 2 === 0 ? 100 + idx : 10
      lines.push(`${x} ${y}`)
    }
    const result = parse_xy_file(lines.join(`\n`))
    expect(result).not.toBeNull()
    // Should subsample to ~1000 points
    expect(result?.x.length).toBeLessThanOrEqual(1000)
    expect(result?.x.length).toBeGreaterThan(500)
    // First and last x values should be preserved
    expect(result?.x[0]).toBeCloseTo(10, 1)
    expect(result?.x[result?.x.length - 1]).toBeCloseTo(109.95, 1)
  })
})

describe(`parse_xye_file`, () => {
  test.each([
    [`space-separated`, `10.0 100 5\n20.0 200 10\n30.0 300 15`],
    [`tab-separated`, `10.0\t100\t5\n20.0\t200\t10\n30.0\t300\t15`],
    [`extra columns`, `10.0 100 5 extra\n20.0 200 10 extra\n30.0 300 15 extra`],
  ])(`parses %s XYE data`, (_desc, content) => {
    const result = parse_xye_file(content)
    expect(result).not.toBeNull()
    expect(result?.x).toEqual([10, 20, 30])
    // Normalized: 100/300*100=33.33, 200/300*100=66.67, 300/300*100=100
    expect(result?.y[0]).toBeCloseTo(33.33, 1)
    expect(result?.y[2]).toBeCloseTo(100, 1)
  })
})

describe(`parse_ras_file`, () => {
  test(`parses standard Rigaku RAS format with header and INT section`, () => {
    const content = `*RAS_DATA_START
*RAS_HEADER_START
*MEAS_SCAN_START=10.0
*MEAS_SCAN_STEP=1.0
*MEAS_SCAN_END=14.0
*RAS_HEADER_END
*RAS_INT_START
100
200
300
200
100
*RAS_INT_END`
    const result = parse_ras_file(content)
    expect(result).not.toBeNull()
    expect(result?.x).toEqual([10, 11, 12, 13, 14])
    // Normalized: max=300 -> 33.33, 66.67, 100, 66.67, 33.33
    expect(result?.y[0]).toBeCloseTo(33.33, 1)
    expect(result?.y[2]).toBeCloseTo(100, 1)
    expect(result?.y[4]).toBeCloseTo(33.33, 1)
  })

  test(`handles alternative SCAN_START/SCAN_STEP keys`, () => {
    const content = `*RAS_HEADER_START
*SCAN_START=20.0
*SCAN_STEP=0.5
*RAS_HEADER_END
*RAS_INT_START
50
100
*RAS_INT_END`
    const result = parse_ras_file(content)
    expect(result).not.toBeNull()
    expect(result?.x).toEqual([20, 20.5])
    expect(result?.y[1]).toBeCloseTo(100, 1)
  })

  test(`handles space-separated intensities on single line`, () => {
    const content = `*MEAS_SCAN_START=5.0
*MEAS_SCAN_STEP=2.0
*RAS_INT_START
100 200 300 400
*RAS_INT_END`
    const result = parse_ras_file(content)
    expect(result).not.toBeNull()
    expect(result?.x).toEqual([5, 7, 9, 11])
    expect(result?.y[3]).toBeCloseTo(100, 1) // max=400, normalized
  })

  test(`returns null for empty content`, () => {
    expect(parse_ras_file(``)).toBeNull()
  })

  test(`returns null for content without intensity data`, () => {
    const content = `*RAS_HEADER_START
*MEAS_SCAN_START=10.0
*RAS_HEADER_END`
    expect(parse_ras_file(content)).toBeNull()
  })
})

describe(`parse_uxd_file`, () => {
  test(`parses standard Siemens UXD format with _COUNTS section`, () => {
    const content = `; Siemens UXD file
_2THETA_START=10.0
_STEPSIZE=1.0
_COUNTS
100
200
300
200
100`
    const result = parse_uxd_file(content)
    expect(result).not.toBeNull()
    expect(result?.x).toEqual([10, 11, 12, 13, 14])
    expect(result?.y[2]).toBeCloseTo(100, 1) // max normalized
  })

  test(`handles alternative _START and _STEPWIDTH keys`, () => {
    const content = `_START=15.0
_STEPWIDTH=0.5
_COUNTS
50 100 150`
    const result = parse_uxd_file(content)
    expect(result).not.toBeNull()
    expect(result?.x).toEqual([15, 15.5, 16])
    expect(result?.y[2]).toBeCloseTo(100, 1)
  })

  test(`ignores semicolon comments`, () => {
    const content = `; Comment line
_2THETA_START=10.0
_STEPSIZE=1.0
; Another comment
_COUNTS
100 200`
    const result = parse_uxd_file(content)
    expect(result).not.toBeNull()
    expect(result?.x.length).toBe(2)
  })

  test(`falls back to two-column parsing if no _COUNTS marker`, () => {
    // UXD files without _COUNTS section may be simple two-column format
    const content = `10.0 100
20.0 200
30.0 300`
    const result = parse_uxd_file(content)
    expect(result).not.toBeNull()
    expect(result?.x).toEqual([10, 20, 30])
  })

  test(`returns null for empty content`, () => {
    expect(parse_uxd_file(``)).toBeNull()
  })
})

describe(`parse_gsas_file`, () => {
  test(`parses GSAS CONST format with BANK header`, () => {
    // CONST format: BCOEF1 is start in centidegrees, BCOEF2 is step in centidegrees
    const content = `GSAS file title
BANK 1 5 5 CONST 1000.0 100.0 0 0 STD
50 100 200 150 75`
    const result = parse_gsas_file(content)
    expect(result).not.toBeNull()
    // start = 1000/100 = 10°, step = 100/100 = 1°
    expect(result?.x).toEqual([10, 11, 12, 13, 14])
    expect(result?.y[2]).toBeCloseTo(100, 1) // max=200
  })

  test(`handles space-separated intensities across multiple lines`, () => {
    const content = `BANK 1 6 6 CONST 2000.0 50.0 0 0 STD
100 200 300
400 500 600`
    const result = parse_gsas_file(content)
    expect(result).not.toBeNull()
    // start = 2000/100 = 20°, step = 50/100 = 0.5°
    expect(result?.x[0]).toBeCloseTo(20, 1)
    expect(result?.x[5]).toBeCloseTo(22.5, 1)
    expect(result?.y[5]).toBeCloseTo(100, 1) // max=600
  })

  test(`handles FXYE format with x,y,e triplets`, () => {
    // In FXYE, data is angle intensity error in triplets
    // BANK header must specify FXYE bin_type for triplet parsing
    const content = `BANK 1 3 3 FXYE 1000.0 100.0 0 0 STD
10.0 100 5 11.0 200 10 12.0 300 15`
    const result = parse_gsas_file(content)
    expect(result).not.toBeNull()
    // Should extract y values (indices 1, 4, 7 from triplets)
    expect(result?.y.length).toBe(3)
    expect(result?.y[2]).toBeCloseTo(100, 1) // max=300
  })

  test(`returns null for empty content`, () => {
    expect(parse_gsas_file(``)).toBeNull()
  })
})

describe(`parse_bruker_raw_file`, () => {
  // Create a mock Bruker RAW v2 file for testing
  function create_mock_raw_v2(
    intensities: number[],
    start: number = 10,
    step: number = 0.5,
  ): ArrayBuffer {
    // V2 header structure (simplified)
    const header_size = 256
    const buffer = new ArrayBuffer(header_size + intensities.length * 4)
    const view = new DataView(buffer)
    const bytes = new Uint8Array(buffer)

    // Magic bytes "RAW2"
    bytes[0] = 82 // R
    bytes[1] = 65 // A
    bytes[2] = 87 // W
    bytes[3] = 50 // 2

    // Header size at offset 4
    view.setUint32(4, header_size, true)

    // Scan parameters (V2 offsets)
    view.setFloat64(48, start, true) // start angle
    view.setFloat64(56, step, true) // step size
    view.setUint32(64, intensities.length, true) // count

    // Intensities as float32
    for (let idx = 0; idx < intensities.length; idx++) {
      view.setFloat32(header_size + idx * 4, intensities[idx], true)
    }

    return buffer
  }

  test(`parses Bruker RAW v2 format`, () => {
    const intensities = [100, 200, 300, 200, 100]
    const buffer = create_mock_raw_v2(intensities, 20, 1)
    const result = parse_bruker_raw_file(buffer)
    expect(result).not.toBeNull()
    expect(result?.x).toEqual([20, 21, 22, 23, 24])
    expect(result?.y[2]).toBeCloseTo(100, 1) // max normalized
  })

  test(`returns null for invalid data`, () => {
    const buffer = new ArrayBuffer(10)
    expect(parse_bruker_raw_file(buffer)).toBeNull()
  })

  test(`returns null for empty buffer`, () => {
    const buffer = new ArrayBuffer(0)
    expect(parse_bruker_raw_file(buffer)).toBeNull()
  })
})

describe(`parse_xrdml_file`, () => {
  // Create a mock XRDML content for testing.
  function create_mock_xrdml(
    intensities: number[],
    start: number = 10,
    end: number = 70,
  ): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<xrdMeasurements>
  <xrdMeasurement>
    <scan>
      <dataPoints>
        <positions axis="2Theta" unit="deg">
          <startPosition>${start}</startPosition>
          <endPosition>${end}</endPosition>
        </positions>
        <intensities unit="counts">${intensities.join(` `)}</intensities>
      </dataPoints>
    </scan>
  </xrdMeasurement>
</xrdMeasurements>`
  }

  test(`returns null for empty intensities`, () => {
    const result = parse_xrdml_file(create_mock_xrdml([], 10, 70))
    expect(result).toBeNull()
  })

  test(`handles all-zero intensities without division by zero`, () => {
    const result = parse_xrdml_file(create_mock_xrdml([0, 0, 0, 0, 0], 10, 50))
    expect(result).not.toBeNull()
    expect(result?.y).toEqual([0, 0, 0, 0, 0])
  })

  test(`parses multi-point XRDML data`, () => {
    const result = parse_xrdml_file(create_mock_xrdml([100, 200, 300], 10, 30))
    expect(result).not.toBeNull()
    expect(result?.x).toEqual([10, 20, 30])
    // Normalized: 100/300=33.33, 200/300=66.67, 300/300=100
    expect(result?.y[0]).toBeCloseTo(33.33, 1)
    expect(result?.y[1]).toBeCloseTo(66.67, 1)
    expect(result?.y[2]).toBeCloseTo(100, 1)
  })

  test(`parses single-point XRDML data`, () => {
    const result = parse_xrdml_file(create_mock_xrdml([500], 45, 45))
    expect(result).not.toBeNull()
    expect(result?.x).toEqual([45])
    expect(result?.y).toEqual([100]) // Single point normalized to 100
  })

  test.each([
    [`invalid XML`, `not xml`],
    [`missing dataPoints`, `<?xml version="1.0"?><xrdMeasurements></xrdMeasurements>`],
    [
      `missing 2Theta`,
      `<?xml version="1.0"?><xrdMeasurements><xrdMeasurement><scan>
      <dataPoints><intensities>100 200</intensities></dataPoints>
    </scan></xrdMeasurement></xrdMeasurements>`,
    ],
    [
      `missing startPosition`,
      `<?xml version="1.0"?><xrdMeasurements><xrdMeasurement><scan><dataPoints>
      <positions axis="2Theta"><endPosition>70</endPosition></positions>
      <intensities>100 200</intensities>
    </dataPoints></scan></xrdMeasurement></xrdMeasurements>`,
    ],
    [
      `non-numeric positions`,
      `<?xml version="1.0"?><xrdMeasurements><xrdMeasurement><scan><dataPoints>
      <positions axis="2Theta"><startPosition>abc</startPosition><endPosition>70</endPosition></positions>
      <intensities>100 200</intensities>
    </dataPoints></scan></xrdMeasurement></xrdMeasurements>`,
    ],
  ])(`returns null for %s`, (_desc, content) => {
    expect(parse_xrdml_file(content)).toBeNull()
  })

  test(`filters non-numeric intensity values`, () => {
    const content =
      `<?xml version="1.0"?><xrdMeasurements><xrdMeasurement><scan><dataPoints>
      <positions axis="2Theta"><startPosition>10</startPosition><endPosition>30</endPosition></positions>
      <intensities>100 NaN 300</intensities>
    </dataPoints></scan></xrdMeasurement></xrdMeasurements>`
    const result = parse_xrdml_file(content)
    // NaN is filtered out, leaving 2 valid points
    expect(result).not.toBeNull()
    expect(result?.x.length).toBe(2)
  })
})

describe(`parse_brml_file`, () => {
  // Create a mock BRML file (ZIP with XML) for testing.
  function create_mock_brml(
    intensities: number[],
    start: number = 10,
    step: number = 0.02,
  ): ArrayBuffer {
    const xml_content = `<?xml version="1.0" encoding="utf-8"?>
<RawData>
  <ScanInformation>
    <Start>${start}</Start>
    <Step>${step}</Step>
  </ScanInformation>
  <DataRoutes>
    <DataRoute>
      <Datum>
        <Intensities>${intensities.join(` `)}</Intensities>
      </Datum>
    </DataRoute>
  </DataRoutes>
</RawData>`

    const files = {
      'RawData0.xml': new TextEncoder().encode(xml_content),
    }
    const zipped = zipSync(files)
    return zipped.buffer as ArrayBuffer
  }

  test(`parses mock BRML file with intensities`, async () => {
    const intensities = [100, 150, 200, 180, 120]
    const brml_buffer = create_mock_brml(intensities, 20, 0.05)

    const result = await parse_brml_file(brml_buffer)
    expect(result).not.toBeNull()
    // y values are normalized to 0-100 (max=200, so 100->50, 150->75, 200->100, etc.)
    expect(result?.y[0]).toBeCloseTo(50, 1)
    expect(result?.y[1]).toBeCloseTo(75, 1)
    expect(result?.y[2]).toBeCloseTo(100, 1)
    expect(result?.x).toHaveLength(intensities.length)
    // Check 2θ values are calculated correctly
    expect(result?.x[0]).toBeCloseTo(20, 5)
    expect(result?.x[1]).toBeCloseTo(20.05, 5)
    expect(result?.x[4]).toBeCloseTo(20.2, 5)
  })

  test.each([
    [
      `invalid ZIP data`,
      () => new TextEncoder().encode(`not a zip`).buffer as ArrayBuffer,
    ],
    [`ZIP without XRD data`, () => {
      const files = { 'readme.txt': new TextEncoder().encode(`not XRD`) }
      return zipSync(files).buffer as ArrayBuffer
    }],
  ])(`returns null for %s`, async (_desc, make_buffer) => {
    expect(await parse_brml_file(make_buffer())).toBeNull()
  })

  test(`handles XML with Counts tag instead of Intensities`, async () => {
    const xml_content = `<?xml version="1.0"?>
<RawData>
  <Start>15</Start>
  <Step>0.01</Step>
  <Counts>50 75 100 90 60</Counts>
</RawData>`
    const files = { 'data.xml': new TextEncoder().encode(xml_content) }
    const zipped = zipSync(files)

    const result = await parse_brml_file(zipped.buffer as ArrayBuffer)
    expect(result).not.toBeNull()
    expect(result?.x[0]).toBeCloseTo(15, 5) // Start angle
    expect(result?.x[4]).toBeCloseTo(15.04, 5) // 15 + 4*0.01
    // Normalized: max=100, so 50->50, 75->75, 100->100, 90->90, 60->60
    expect(result?.y).toEqual([50, 75, 100, 90, 60])
  })

  test(`handles Bruker HRXRD 8-column Datum format`, async () => {
    // Format: flags, flags, 2Theta, Omega, ..., intensity (8 columns)
    const xml_content = `<?xml version="1.0"?>
<RawData>
  <DataRoutes>
    <DataRoute>
      <Datum>1,1,44,18.028,-0.12937,0,2.63482,3</Datum>
      <Datum>1,1,44.002,18.029,-0.12937,0,2.63493,1</Datum>
      <Datum>1,1,44.004,18.03,-0.12938,0,2.63505,5</Datum>
      <Datum>1,1,44.006,18.031,-0.12938,0,2.63516,2</Datum>
    </DataRoute>
  </DataRoutes>
</RawData>`
    const files = { 'RawData0.xml': new TextEncoder().encode(xml_content) }
    const zipped = zipSync(files)

    const result = await parse_brml_file(zipped.buffer as ArrayBuffer)
    expect(result).not.toBeNull()
    // Check all 2θ values from column 2
    expect(result?.x[0]).toBeCloseTo(44, 5)
    expect(result?.x[1]).toBeCloseTo(44.002, 5)
    expect(result?.x[2]).toBeCloseTo(44.004, 5)
    expect(result?.x[3]).toBeCloseTo(44.006, 5)
    // Intensities 3,1,5,2 normalized: max=5 -> 60,20,100,40
    expect(result?.y[0]).toBeCloseTo(60, 1)
    expect(result?.y[1]).toBeCloseTo(20, 1)
    expect(result?.y[2]).toBeCloseTo(100, 1)
    expect(result?.y[3]).toBeCloseTo(40, 1)
  })

  test(`handles Bruker powder 5-column Datum format`, async () => {
    // Format: time, flag, 2Theta, Theta, intensity (5 columns)
    const xml_content = `<?xml version="1.0"?>
<RawData>
  <DataRoutes>
    <DataRoute>
      <Datum>19.2,1,4.9979,2.49895,5301</Datum>
      <Datum>19.2,1,5.01847,2.50924,5307</Datum>
      <Datum>19.2,1,5.03904,2.51952,5177</Datum>
    </DataRoute>
  </DataRoutes>
</RawData>`
    const files = { 'RawData0.xml': new TextEncoder().encode(xml_content) }
    const zipped = zipSync(files)

    const result = await parse_brml_file(zipped.buffer as ArrayBuffer)
    expect(result).not.toBeNull()
    // Check all 2θ values from column 2
    expect(result?.x[0]).toBeCloseTo(4.9979, 4)
    expect(result?.x[1]).toBeCloseTo(5.01847, 4)
    expect(result?.x[2]).toBeCloseTo(5.03904, 4)
    // Normalized: max=5307 -> 5301/5307*100≈99.89, 100, 5177/5307*100≈97.55
    expect(result?.y[0]).toBeCloseTo(99.89, 1)
    expect(result?.y[1]).toBeCloseTo(100, 1)
    expect(result?.y[2]).toBeCloseTo(97.55, 1)
  })

  test(`handles Bruker HRXRD format with Experiment0/ path prefix`, async () => {
    // Real BRML files have nested directory structure like Experiment0/RawData0.xml
    const xml_content = `<?xml version="1.0"?>
<RawData xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <DataRoutes>
    <DataRoute>
      <Datum>1,1,44,18.028,-0.12937,0,2.63482,10</Datum>
      <Datum>1,1,44.002,18.029,-0.12937,0,2.63493,20</Datum>
      <Datum>1,1,44.004,18.03,-0.12938,0,2.63505,30</Datum>
    </DataRoute>
  </DataRoutes>
</RawData>`
    const files = {
      'Experiment0/RawData0.xml': new TextEncoder().encode(xml_content),
      'Experiment0/OtherFile.xml': new TextEncoder().encode(`<Other/>`),
      'experimentCollection.xml': new TextEncoder().encode(`<Collection/>`),
    }
    const zipped = zipSync(files)

    const result = await parse_brml_file(zipped.buffer as ArrayBuffer)
    expect(result).not.toBeNull()
    expect(result?.x[0]).toBeCloseTo(44, 5)
    expect(result?.x[1]).toBeCloseTo(44.002, 5)
    expect(result?.x[2]).toBeCloseTo(44.004, 5)
    // Intensities 10,20,30 normalized: 33.33, 66.67, 100
    expect(result?.y[0]).toBeCloseTo(33.33, 1)
    expect(result?.y[1]).toBeCloseTo(66.67, 1)
    expect(result?.y[2]).toBeCloseTo(100, 1)
  })

  test(`finds Datum data in fallback XML search`, async () => {
    // When RawData file is not named 'rawdata', fall back to searching all XMLs
    const xml_content = `<?xml version="1.0"?>
<RawData>
  <DataRoutes>
    <DataRoute>
      <Datum>1,1,30,15,-0.1,0,2.5,100</Datum>
      <Datum>1,1,30.01,15.005,-0.1,0,2.501,200</Datum>
    </DataRoute>
  </DataRoutes>
</RawData>`
    const files = {
      'Experiment0/DataFile.xml': new TextEncoder().encode(xml_content),
    }
    const zipped = zipSync(files)

    const result = await parse_brml_file(zipped.buffer as ArrayBuffer)
    expect(result).not.toBeNull()
    expect(result?.x[0]).toBeCloseTo(30, 5)
    expect(result?.x[1]).toBeCloseTo(30.01, 5)
    expect(result?.y[0]).toBeCloseTo(50, 1)
    expect(result?.y[1]).toBeCloseTo(100, 1)
  })

  test(`handles single-element Datum array without divide-by-zero`, async () => {
    // Edge case: single data point should not cause NaN/Infinity from step calculation
    const xml_content = `<?xml version="1.0"?>
<RawData>
  <DataRoutes>
    <DataRoute>
      <Datum>19.2,1,45.5,22.75,1000</Datum>
    </DataRoute>
  </DataRoutes>
</RawData>`
    const files = { 'RawData0.xml': new TextEncoder().encode(xml_content) }
    const zipped = zipSync(files)

    const result = await parse_brml_file(zipped.buffer as ArrayBuffer)
    expect(result).not.toBeNull()
    expect(result?.x).toEqual([45.5])
    expect(result?.y).toEqual([100]) // Single element normalized to 100
  })
})

describe(`parse_xrd_file`, () => {
  const xy_content = `10.0 100\n20.0 200`
  const brml_xml = `<?xml version="1.0"?>
<RawData><Start>10</Start><Step>1</Step><Intensities>100 200</Intensities></RawData>`

  test.each([
    [`xy string`, xy_content, `data.xy`],
    [`xy ArrayBuffer`, new TextEncoder().encode(xy_content).buffer, `data.xy`],
    [`xye`, `10.0 100 5\n20.0 200 10`, `data.xye`],
    // New two-column aliases
    [`csv`, `10.0,100\n20.0,200`, `data.csv`],
    [`dat`, `10.0 100\n20.0 200`, `data.dat`],
    [`asc`, `10.0 100\n20.0 200`, `data.asc`],
    [`txt`, `10.0 100\n20.0 200`, `data.txt`],
    [
      `xrdml`,
      `<?xml version="1.0"?><xrdMeasurements><xrdMeasurement><scan>
      <dataPoints><positions axis="2Theta"><startPosition>10</startPosition>
      <endPosition>20</endPosition></positions><intensities>100 200</intensities>
      </dataPoints></scan></xrdMeasurement></xrdMeasurements>`,
      `scan.xrdml`,
    ],
  ])(`routes %s files correctly`, async (_desc, content, filename) => {
    const result = await parse_xrd_file(content as string | ArrayBuffer, filename)
    expect(result).not.toBeNull()
    expect(result?.x).toEqual([10, 20])
    expect(result?.y[1]).toBeCloseTo(100, 1) // max normalized to 100
  })

  test(`routes .brml files correctly`, async () => {
    const files = { 'RawData0.xml': new TextEncoder().encode(brml_xml) }
    const result = await parse_xrd_file(zipSync(files).buffer as ArrayBuffer, `scan.brml`)
    expect(result).not.toBeNull()
    expect(result?.x).toEqual([10, 11]) // Start=10, Step=1
    expect(result?.y[0]).toBeCloseTo(50, 1) // 100/200*100
    expect(result?.y[1]).toBeCloseTo(100, 1) // 200/200*100
  })

  test(`routes .ras files correctly`, async () => {
    const ras_content = `*MEAS_SCAN_START=10.0
*MEAS_SCAN_STEP=10.0
*RAS_INT_START
100 200
*RAS_INT_END`
    const result = await parse_xrd_file(ras_content, `scan.ras`)
    expect(result).not.toBeNull()
    expect(result?.x).toEqual([10, 20])
    expect(result?.y[1]).toBeCloseTo(100, 1)
  })

  test(`routes .uxd files correctly`, async () => {
    const uxd_content = `_2THETA_START=10.0
_STEPSIZE=10.0
_COUNTS
100 200`
    const result = await parse_xrd_file(uxd_content, `scan.uxd`)
    expect(result).not.toBeNull()
    expect(result?.x).toEqual([10, 20])
    expect(result?.y[1]).toBeCloseTo(100, 1)
  })

  test(`routes .gsas files correctly`, async () => {
    const gsas_content = `BANK 1 2 2 CONST 1000.0 1000.0 0 0 STD
100 200`
    const result = await parse_xrd_file(gsas_content, `scan.gsas`)
    expect(result).not.toBeNull()
    expect(result?.x).toEqual([10, 20]) // 1000/100=10, step=1000/100=10
    expect(result?.y[1]).toBeCloseTo(100, 1)
  })

  test(`returns null for unsupported extension`, async () => {
    expect(await parse_xrd_file(`content`, `data.pdf`)).toBeNull()
  })
})

describe(`is_xrd_data_file`, () => {
  test.each([
    // Original formats
    [`sample.xy`, true],
    [`data.xye`, true],
    [`scan.xrdml`, true],
    [`scan.brml`, true],
    [`SAMPLE.XY`, true],
    [`DATA.XYE`, true],
    [`SCAN.XRDML`, true],
    [`SCAN.BRML`, true],
    // New ASCII two-column aliases
    [`data.csv`, true],
    [`data.dat`, true],
    [`data.asc`, true],
    [`data.txt`, true],
    // New header-based formats
    [`rigaku.ras`, true],
    [`siemens.uxd`, true],
    [`rietveld.gsas`, true],
    [`rietveld.gsa`, true],
    [`rietveld.gda`, true],
    [`fullprof.fxye`, true],
    // New binary formats
    [`bruker.raw`, true],
    // Gzipped variants
    [`sample.xy.gz`, true],
    [`data.xye.gz`, true],
    [`scan.xrdml.gz`, true],
    [`scan.brml.gz`, true],
    [`SAMPLE.XY.GZ`, true],
    [`rigaku.ras.gz`, true],
    [`siemens.uxd.gz`, true],
    [`bruker.raw.gz`, true],
    // Non-XRD files
    [`data.cif`, false],
    [`structure.json`, false],
    [`file.xyz`, false],
    [`noextension`, false],
    [`data.gz`, false], // Just .gz without valid base extension
  ])(`is_xrd_data_file("%s") returns %s`, (filename, expected) => {
    expect(is_xrd_data_file(filename)).toBe(expected)
  })
})

describe(`real example files`, () => {
  // These tests load actual example files from static/xrd/ to catch corrupted downloads
  const static_xrd_dir = path.resolve(`static/xrd`)

  // Get all XRD files in static/xrd/ (including gzipped variants)
  // Include all supported extensions: original + new formats
  // deno-fmt-ignore
  const xrd_extensions = [
    `.xy`, `.xye`, `.xrdml`, `.brml`, // Original
    `.csv`, `.dat`, `.asc`, `.txt`, // Two-column aliases
    `.ras`, `.uxd`, `.gsas`, `.gsa`, `.gda`, `.fxye`, // Header-based
    `.raw`, // Binary
  ]
  const xrd_files: string[] = fs.readdirSync(static_xrd_dir).filter((file: string) => {
    const lower = file.toLowerCase()
    // Match .xy, .xy.gz, .xye, .xye.gz, etc.
    return xrd_extensions.some(
      (ext) => lower.endsWith(ext) || lower.endsWith(`${ext}.gz`),
    )
  })

  for (const filename of xrd_files) {
    test(`parses ${filename} successfully`, async () => {
      const filepath = path.join(static_xrd_dir, filename)
      let content: Buffer = fs.readFileSync(filepath)

      // Decompress gzipped files
      const is_gzipped = filename.toLowerCase().endsWith(`.gz`)
      if (is_gzipped) {
        content = zlib.gunzipSync(content)
      }

      // Get base filename (without .gz) for format detection
      const base_filename = is_gzipped ? filename.slice(0, -3) : filename
      const base_ext = base_filename.split(`.`).pop()?.toLowerCase()

      // Use ArrayBuffer for binary formats, string for text
      const is_binary = [`brml`, `raw`].includes(base_ext ?? ``)
      const input = is_binary ? content.buffer : content.toString()
      const result = await parse_xrd_file(input as string | ArrayBuffer, base_filename)

      expect(result).not.toBeNull()
      if (!result) return // Type guard for TypeScript
      expect(result.x.length).toBeGreaterThan(0)
      expect(result.y.length).toBeGreaterThan(0)
      expect(result.x.length).toBe(result.y.length)
      // Verify max is normalized to 100
      expect(Math.max(...result.y)).toBeCloseTo(100, 0)
      // Min can be negative for background-subtracted data, but should be finite
      expect(Number.isFinite(Math.min(...result.y))).toBe(true)
    })
  }
})
