import {
  is_xrd_data_file,
  parse_block_scan,
  parse_brml_file,
  parse_bruker_raw_file,
  parse_gsas_file,
  parse_ras_file,
  parse_rigaku_asc_file,
  parse_uxd_file,
  parse_xrd_file,
  parse_xrdml_file,
  parse_xy_file,
} from '$lib/xrd/parse'
import { zipSync } from 'fflate'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { describe, expect, test } from 'vitest'

// Three points normalised to max = 100: 100/200/300 → 33.3/66.7/100
const rounded = (result: { x: number[]; y: number[] }) => ({
  x: result.x,
  y: result.y.map((val) => Math.round(val * 100) / 100),
})
const THREE_POINTS = { x: [10, 20, 30], y: [33.33, 66.67, 100] }

describe(`parse_xy_file`, () => {
  test.each([
    [`space-separated`, `10.0 100\n20.0 200\n30.0 300`],
    [`tab-separated`, `10.0\t100\n20.0\t200\n30.0\t300`],
    [`comma-separated`, `10.0,100\n20.0,200\n30.0,300`],
    [`CRLF and blank lines`, `10.0 100\r\n\r\n20.0 200\r\n30.0 300`],
    [`comment lines (#, ;, !)`, `# c\n10.0 100\n; c\n20.0 200\n! c\n30.0 300`],
    [`XYE third column ignored`, `10.0 100 5\n20.0 200 10\n30.0 300 15`],
    [
      `rows with fewer than two numbers skipped`,
      `10.0 100\n20.0\nabc def\n20.0 200\n30.0 300`,
    ],
  ])(`parses %s`, (_name, content) =>
    expect(rounded(parse_xy_file(content))).toEqual(THREE_POINTS),
  )

  test(`scientific notation and negative (background-subtracted) intensities`, () => {
    expect(parse_xy_file(`10 1e3\n20 2.5e-2\n30 3E4`).y[0]).toBeCloseTo(100 / 30, 6)
    expect(parse_xy_file(`10 -5\n20 50\n30 100\n40 -10`).y).toEqual([-5, 50, 100, -10])
    expect(parse_xy_file(`10 0\n20 0`).y).toEqual([0, 0]) // all-zero: no division by zero
  })

  // Deterministic pseudo-random counts, so x reverses on roughly every other row
  const noise = (row: number) => (row * 7919) % 100

  test.each([
    [`empty content`, ``, /no rows with two numeric columns/],
    [`only comments`, `# a\n# b`, /no rows with two numeric columns/],
    // five counts per row read as columns: x is the first count of each row
    [
      `a block of counts`,
      Array.from({ length: 20 }, (_, row) => `${noise(row)} 2 3 4 5`).join(`\n`),
      /column 1 reverses direction in 3 of 19 steps.* look like a block of bare counts, 5 per row/,
    ],
    // a tiny block still alternates: 2 reversals in 4 steps is more than one glitch
    [
      `a five-row block of counts`,
      `10 1 29\n500 1 2 3 4\n1 2 3 4 5\n500 1 2 3 4\n1 2 3 4 5`,
      /reverses direction in 2 of 4 steps/,
    ],
    [
      `two columns of (intensity, error) pairs`,
      Array.from({ length: 30 }, (_, row) => `${noise(row)} ${Math.sqrt(noise(row))}`).join(
        `\n`,
      ),
      /column 1 reverses direction in \d+ of 29 steps.*the 30 rows look like \(intensity, error\) pairs/,
    ],
  ])(`throws on %s`, (_name, content, pattern) => {
    expect(() => parse_xy_file(content)).toThrow(pattern)
  })

  test.each([
    // two ranges, the second restarting below the end of the first
    [
      `a stitched two-range scan`,
      [
        ...Array.from({ length: 12 }, (_, idx) => 30 + idx),
        ...Array.from({ length: 12 }, (_, idx) => 40.5 + idx),
      ],
    ],
    // three ranges: 2 restarts in 35 steps are within one per ten
    [
      `a stitched three-range scan`,
      [
        ...Array.from({ length: 12 }, (_, idx) => 10 + idx),
        ...Array.from({ length: 12 }, (_, idx) => 21.5 + idx),
        ...Array.from({ length: 12 }, (_, idx) => 33 + idx),
      ],
    ],
    // one reversal is a glitch whatever the length: 1 of 8 steps is 12.5%
    [`a 9-point scan with one glitch`, [10, 11, 12, 13, 15, 14, 16, 17, 18]],
    [`a descending scan with one glitch`, [18, 17, 16, 14, 15, 13, 12, 11, 10]],
    // the first and last angle coincide, so the direction has to come from the majority
    [
      `a scan whose restart lands on its first angle`,
      [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 10],
    ],
  ])(`tolerates %s`, (_name, angles) => {
    const result = parse_xy_file(angles.map((angle, idx) => `${angle} ${idx + 1}`).join(`\n`))
    expect(result.x).toEqual(angles)
  })

  test.each([
    [1000, 1000],
    [1001, 1000],
    [4000, 1000],
  ])(`%i points subsample to at most %i, keeping the strongest peaks`, (count, max_points) => {
    // 30 peaks off the uniform grid (20–100 tall on a background of 1)
    const peak_indices = Array.from(
      { length: 30 },
      (_, idx) => idx * Math.floor(count / 31) + 7,
    )
    const lines = Array.from({ length: count }, (_, idx) => {
      const peak = peak_indices.indexOf(idx)
      return `${10 + idx * 0.01} ${peak === -1 ? 1 : 20 + (peak * 80) / 29}`
    })
    const result = parse_xy_file(lines.join(`\n`))
    expect(result.x.length).toBeLessThanOrEqual(max_points)
    if (count <= max_points) expect(result.x).toHaveLength(count)
    const kept = peak_indices.filter((idx) =>
      result.x.some((x_val) => Math.abs(x_val - (10 + idx * 0.01)) < 1e-9),
    )
    expect(kept.length).toBeGreaterThanOrEqual(count <= max_points ? 30 : 25)
  })
})

describe(`parse_block_scan (ILL / PSI neutron layouts)`, () => {
  test(`reads n counts after a 'start step stop' line and ignores the trailing sigmas`, () => {
    const content = `title line\nlambda= 1.494, T= 0\n  10.0  0.5  12.0 18000000., sample="x"\n 100. 200. 300. 400. 500.\n 1. 2. 3. 4. 5.\n a4=2.9; Numor=1`
    const result = parse_block_scan(content)
    expect(result.x).toEqual([10, 10.5, 11, 11.5, 12])
    expect(result.y).toEqual([20, 40, 60, 80, 100])
  })

  test.each([
    [`no header line`, `title\n10 -1 5\n7 8`, /no 'start step stop' header/],
    [`too few counts`, `10 0.5 12\n100 200`, /announces 5 points but only 2 follow/],
    // a non-numeric row ends the block; the numbers after it are not counts
    [
      `a footer inside the block`,
      `10 0.5 12\n100 200\nNumor=1\n300 400 500`,
      /announces 5 points but only 2 follow/,
    ],
  ])(`throws on %s`, (_name, content, pattern) => {
    expect(() => parse_block_scan(content)).toThrow(pattern)
  })
})

describe(`parse_rigaku_asc_file`, () => {
  const header = `*TYPE = Raw\n*START = 4\n*STOP = 4.03\n*STEP = 0.01\n*COUNT = 4\n*BEGIN\n`
  test(`uses *START/*STEP and the counts between *BEGIN and *END`, () => {
    const result = parse_rigaku_asc_file(`${header}10, 20\n30, 40\n*END`)
    expect(result.x.map((val) => Math.round(val * 100) / 100)).toEqual([4, 4.01, 4.02, 4.03])
    expect(result.y).toEqual([25, 50, 75, 100])
  })
  test.each([
    [`a count mismatch`, `${header}10, 20\n*END`, /header implies 4 points .* but 2 counts/],
    [`missing *STEP`, `*START = 4\n*BEGIN\n1\n*END`, /missing \*START or positive \*STEP/],
  ])(`throws on %s`, (_name, content, pattern) => {
    expect(() => parse_rigaku_asc_file(content)).toThrow(pattern)
  })
})

describe(`parse_ras_file`, () => {
  const wrap = (data: string, header = ``) =>
    `*RAS_HEADER_START\n${header}*RAS_HEADER_END\n*RAS_INT_START\n${data}\n*RAS_INT_END`

  test(`three-column rows (2theta, intensity, attenuation) use the row angles`, () => {
    const content = wrap(`10.0 100 1.0\n20.0 200 1.0\n30.0 300 1.0`)
    expect(rounded(parse_ras_file(content))).toEqual(THREE_POINTS)
  })

  test(`single-column counts use the quoted *MEAS_SCAN_START / *MEAS_SCAN_STEP`, () => {
    const header = `*MEAS_SCAN_START "10.0000000000"\n*MEAS_SCAN_START_TIME "11/01/12"\n*MEAS_SCAN_STEP "10.0000000000"\n`
    const content = wrap(`100\n200\n300`, header)
    expect(rounded(parse_ras_file(content))).toEqual(THREE_POINTS)
  })

  test.each([
    [`no *RAS_INT_START`, `*RAS_HEADER_START\n*RAS_HEADER_END\n100 200`, /no \*RAS_INT_START/],
    [`an empty section`, wrap(``), /empty \*RAS_INT_START section/],
    [`single-column counts without a grid`, wrap(`100\n200`), /need \*MEAS_SCAN_START/],
  ])(`throws on %s`, (_name, content, pattern) => {
    expect(() => parse_ras_file(content)).toThrow(pattern)
  })
})

describe(`parse_uxd_file`, () => {
  test.each([
    [
      `_2THETACOUNTS two-column section`,
      `_START=3\n_2THETACOUNTS\n10.0\t100\n20.0\t200\n30.0\t300\n_NEXT=1\n1 2`,
    ],
    [
      `_COUNTS on the _START/_STEPSIZE grid`,
      `; comment\n_START=10.0\n_STEPSIZE=10.0\n_COUNTS\n100 200\n300`,
    ],
    [`_2THETA / _STEPWIDTH aliases`, `_2THETA=10.0\n_STEPWIDTH=10.0\n_COUNTS\n100\n200\n300`],
    // _2THETA is the detector position at the start; _START is the scan start even when listed later
    [
      `_START over a preceding _2THETA`,
      `_2THETA=40\n_START=10\n_STEPSIZE=10\n_COUNTS\n100 200 300`,
    ],
  ])(`parses %s`, (_name, content) =>
    expect(rounded(parse_uxd_file(content))).toEqual(THREE_POINTS),
  )

  test.each([
    [`no counts section`, `_START=10\n10 100\n20 200`, /no _COUNTS or _2THETACOUNTS/],
    [`_COUNTS without a grid`, `_COUNTS\n100 200`, /needs _START/],
  ])(`throws on %s`, (_name, content, pattern) => {
    expect(() => parse_uxd_file(content)).toThrow(pattern)
  })
})

describe(`parse_gsas_file`, () => {
  test.each([
    `BANK 1 3 1 CONST 1000 1000 0 0\n100 200 300`,
    // NCHAN = 3 but the last record is zero-padded to a full line
    `title\nBANK 1 3 1 CONST 1000.0 1000.0 0 0 STD\n100 200 300 0 0`,
  ])(`CONST/STD bank %#: centidegree start and step, first NCHAN values`, (content) =>
    expect(rounded(parse_gsas_file(content))).toEqual(THREE_POINTS),
  )

  test(`fixed-width STD records keep the F6.0 intensity and drop the I2 detector count`, () => {
    // 10(I2,F6.0) with NCTR 1..10 glued to the counts, as multi-detector neutron banks write
    const record = ` 1   100 2   200 3   300 4   400 5   500 6   600 7   700 8   80010   90010  1000`
    const padded = `10   500 0     0                                                                `
    const result = parse_gsas_file(`BANK 1 11 2 CONST 1000 100 0 0\n${record}\n${padded}`)
    expect(result.y).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 50])
    expect(result.x[10]).toBeCloseTo(20, 9)
  })

  test(`ESD banks interleave sigmas and FXYE banks carry their own centidegree x`, () => {
    const esd = parse_gsas_file(`BANK 1 3 1 CONST 1000 1000 0 0 ESD\n100 5 200 7 300 9`)
    expect(rounded(esd)).toEqual(THREE_POINTS)
    const fxye = parse_gsas_file(
      `BANK 1 3 1 CONST 0 0 0 0 FXYE\n1000 100 5 2000 200 7 3000 300 9`,
    )
    expect(rounded(fxye)).toEqual(THREE_POINTS)
  })

  test.each([
    [`no BANK line`, `100 200 300`, /no BANK header/],
    [`a time-of-flight bank`, `BANK 1 3 1 RALF 1000 2 0 0\n1 2 3`, /BINTYP 'RALF'/],
    [
      `too few values`,
      `BANK 1 3 1 CONST 1000 1000 0 0\n1 2`,
      /declares 3 channels .* but 2 follow/,
    ],
  ])(`throws on %s`, (_name, content, pattern) => {
    expect(() => parse_gsas_file(content)).toThrow(pattern)
  })
})

describe(`parse_bruker_raw_file (RAW1.01)`, () => {
  // RAW1.01 byte layout (little-endian), as in the BT86.raw / Cu3Au-1.raw fixtures:
  //   file header, 712 bytes: `RAW1.01` at 0, uint32 range count at 12
  //   per range, one block after another:
  //     range header, 304 bytes: uint32 header length (304) at 0, uint32 step count at 4,
  //       float64 start 2θ at 16, float64 step size at 176, uint32 supplementary size at 256
  //     supplementary header bytes (the size just read)
  //     float32 counts, one per step
  type Range = { counts: number[]; start: number; step: number; supplementary?: number }
  const range_block = ({ counts, start, step, supplementary = 0 }: Range) => {
    const block = new Uint8Array(304 + supplementary + 4 * counts.length)
    const view = new DataView(block.buffer)
    view.setUint32(0, 304, true)
    view.setUint32(4, counts.length, true)
    view.setFloat64(16, start, true)
    view.setFloat64(176, step, true)
    view.setUint32(256, supplementary, true)
    counts.forEach((val, idx) => view.setFloat32(304 + supplementary + 4 * idx, val, true))
    return block
  }
  const make_raw101 = (ranges: Range[]) => {
    const blocks = ranges.map(range_block)
    const bytes = new Uint8Array(712 + blocks.reduce((sum, block) => sum + block.length, 0))
    bytes.set(new TextEncoder().encode(`RAW1.01`), 0)
    new DataView(bytes.buffer).setUint32(12, ranges.length, true)
    let offset = 712
    for (const block of blocks) {
      bytes.set(block, offset)
      offset += block.length
    }
    return bytes.buffer
  }
  const one_range = (counts: number[], start = 10, step = 0.5, supplementary = 40) =>
    make_raw101([{ counts, start, step, supplementary }])

  test.each([0, 40])(
    `decodes the range header with %i supplementary bytes`,
    (supplementary) => {
      const result = parse_bruker_raw_file(one_range([100, 200, 300], 10, 10, supplementary))
      expect(rounded(result)).toEqual(THREE_POINTS)
    },
  )

  test(`concatenates every range in 2theta order, each on its own grid`, () => {
    // stored high range first, with different step sizes and supplementary header sizes
    const high = { counts: [50, 400], start: 40, step: 10, supplementary: 24 }
    const low = { counts: [100, 200, 300], start: 10, step: 10 }
    const result = parse_bruker_raw_file(make_raw101([high, low]))
    expect(result.x).toEqual([10, 20, 30, 40, 50])
    expect(result.y).toEqual([25, 50, 75, 12.5, 100])
  })

  test.each([
    [
      `a RAW2 file`,
      () => new TextEncoder().encode(`RAW2.00${`\0`.repeat(2000)}`).buffer,
      /version 'RAW2.00' is not supported/,
    ],
    [
      `a RAW4 file`,
      () => new TextEncoder().encode(`RAW4.00${`\0`.repeat(2000)}`).buffer,
      /RAW4.00/,
    ],
    [`an unrelated binary`, () => new ArrayBuffer(100), /bad magic/],
    [
      `a truncated header`,
      () => new TextEncoder().encode(`RAW1.01`).buffer,
      /shorter than the 1016-byte headers/,
    ],
    [
      `a range that overruns the file`,
      () => one_range([1, 2, 3]).slice(0, 712 + 304 + 40 + 8),
      /range 1 of 1 announces 3 float32 counts .* but the file ends/,
    ],
    [
      `a second range header cut off by the end of the file`,
      () => {
        const buffer = one_range([1, 2, 3])
        new DataView(buffer).setUint32(12, 2, true)
        return buffer
      },
      /range 2 of 2 header at byte 1068 runs past the end of the 1068-byte file/,
    ],
    [
      `a second range with a zero step size`,
      () =>
        make_raw101([
          { counts: [1], start: 10, step: 1 },
          { counts: [1], start: 20, step: 0 },
        ]),
      /range 2 of 2 header has steps=1, start=20, step=0/,
    ],
  ])(`throws on %s`, (_name, make_buffer, pattern) => {
    expect(() => parse_bruker_raw_file(make_buffer())).toThrow(pattern)
  })
})

describe(`parse_xrdml_file`, () => {
  const xrdml = (intensities: string, start = 10, end = 30) =>
    `<?xml version="1.0"?><xrdMeasurements><xrdMeasurement><scan><dataPoints>
      <positions axis="2Theta" unit="deg"><startPosition>${start}</startPosition><endPosition>${end}</endPosition></positions>
      <intensities unit="counts">${intensities}</intensities>
    </dataPoints></scan></xrdMeasurement></xrdMeasurements>`

  test(`spreads the intensities uniformly between start and end`, () => {
    const content = xrdml(`100 200 300`)
    expect(rounded(parse_xrdml_file(content))).toEqual(THREE_POINTS)
    expect(parse_xrdml_file(xrdml(`500`, 45, 45))).toEqual({ x: [45], y: [100] })
  })

  test.each([
    [`invalid XML`, `not xml`, /invalid XML/],
    [`missing dataPoints`, `<?xml version="1.0"?><xrdMeasurements/>`, /no <dataPoints>/],
    [
      `missing 2Theta positions`,
      `<xrdMeasurements><scan><dataPoints><intensities>1 2</intensities></dataPoints></scan></xrdMeasurements>`,
      /needs numeric startPosition and endPosition/,
    ],
    [`empty intensities`, xrdml(``), /empty <intensities>/],
  ])(`throws on %s`, (_name, content, pattern) => {
    expect(() => parse_xrdml_file(content)).toThrow(pattern)
  })
})

describe(`parse_brml_file`, () => {
  const zip = (files: Record<string, string>) =>
    zipSync(
      Object.fromEntries(
        Object.entries(files).map(([name, text]) => [name, new TextEncoder().encode(text)]),
      ),
    ).buffer

  test.each([
    // 2θ is always column 3 and the intensity the last column, whatever the column count
    {
      desc: `HRXRD 8-column Datum rows`,
      xml: `<RawData><DataRoutes><DataRoute>
        <Datum>1,1,44,18.028,-0.12937,0,2.63482,3</Datum>
        <Datum>1,1,44.002,18.029,-0.12937,0,2.63493,1</Datum>
        <Datum>1,1,44.004,18.03,-0.12938,0,2.63505,5</Datum></DataRoute></DataRoutes></RawData>`,
      x: [44, 44.002, 44.004],
      y: [60, 20, 100],
    },
    {
      desc: `powder 5-column Datum rows`,
      xml: `<RawData><Datum>19.2,1,5.0,2.5,100</Datum><Datum>19.2,1,5.02,2.51,200</Datum></RawData>`,
      x: [5, 5.02],
      y: [50, 100],
    },
    {
      desc: `an <Intensities> list on the <Start>/<Step> grid`,
      xml: `<RawData><ScanInformation><Start>20</Start><Step>0.05</Step></ScanInformation><Intensities>100 150 200</Intensities></RawData>`,
      x: [20, 20.05, 20.1],
      y: [50, 75, 100],
    },
    {
      desc: `a <Counts> list on the <Start>/<Stop> grid`,
      xml: `<RawData><Start>15</Start><Stop>15.04</Stop><Counts>50 75 100 90 60</Counts></RawData>`,
      x: [15, 15.01, 15.02, 15.03, 15.04],
      y: [50, 75, 100, 90, 60],
    },
  ])(`reads $desc`, async ({ xml, x, y }) => {
    const result = await parse_brml_file(zip({ 'Experiment0/RawData0.xml': xml }))
    result.x.forEach((val, idx) => expect(val).toBeCloseTo(x[idx], 9))
    result.y.forEach((val, idx) => expect(val).toBeCloseTo(y[idx], 9))
  })

  test(`falls back to any XML entry carrying Datum rows when no RawData file exists`, async () => {
    const xml = `<X><Datum>1,1,30,15,100</Datum><Datum>1,1,30.01,15,200</Datum></X>`
    const result = await parse_brml_file(zip({ 'Experiment0/DataFile.xml': xml }))
    expect(result.x).toEqual([30, 30.01])
  })

  test.each([
    [
      `invalid ZIP data`,
      () => new TextEncoder().encode(`not a zip`).buffer,
      /not a ZIP archive/,
    ],
    [
      `a ZIP without XRD data`,
      () => zip({ 'readme.txt': `hi` }),
      /no RawData XML among 1 archive entries/,
    ],
    [
      `RawData without intensities`,
      () => zip({ 'RawData0.xml': `<RawData/>` }),
      /neither <Datum> rows nor/,
    ],
    [
      `a list without a grid`,
      () => zip({ 'RawData0.xml': `<RawData><Counts>1 2</Counts></RawData>` }),
      /without a usable <Start>/,
    ],
  ])(`throws on %s`, async (_name, make_buffer, pattern) => {
    await expect(parse_brml_file(make_buffer())).rejects.toThrow(pattern)
  })
})

describe(`parse_xrd_file routing`, () => {
  const xy = `10.0 100\n20.0 200`
  test.each([
    [`data.xy`, xy],
    [`data.xy`, new TextEncoder().encode(xy).buffer], // ArrayBuffer text
    [`data.xye`, `10.0 100 5\n20.0 200 10`],
    [`data.csv`, `10.0,100\n20.0,200`],
    [`data.dat`, xy],
    [`data.txt`, xy],
    [`DATA.XY`, xy], // case-insensitive
    [`data.xy.gz`, xy], // .gz stripped (content already inflated)

    [`rigaku.asc`, `*START = 10\n*STEP = 10\n*BEGIN\n100, 200\n*END`],
    [`scan.ras`, `*RAS_INT_START\n10 100 1\n20 200 1\n*RAS_INT_END`],
    [`scan.uxd`, `_START=10\n_STEPSIZE=10\n_COUNTS\n100 200`],
    [`scan.gsas`, `BANK 1 2 1 CONST 1000 1000 0 0\n100 200`],
    [
      `scan.xrdml`,
      `<xrdMeasurements><scan><dataPoints><positions axis="2Theta"><startPosition>10</startPosition><endPosition>20</endPosition></positions><intensities>100 200</intensities></dataPoints></scan></xrdMeasurements>`,
    ],
  ])(`routes %s to the right parser`, async (filename, content) => {
    const result = await parse_xrd_file(content, filename)
    expect(result.x).toEqual([10, 20])
    expect(result.y).toEqual([50, 100])
  })

  test(`routes a count block under the catch-all .dat to the block parser`, async () => {
    // Read as columns this reverses on every other row, which is what rules out xy
    const rows = [`500 1 2 3 4`, `1 2 3 4 5`, `500 1 2 3 4`, `1 2 3 4 5`]
    const result = await parse_xrd_file([`10 1 29`, ...rows].join(`\n`), `counts.dat`)
    expect(result.x).toHaveLength(20)
    expect(result.x[0]).toBe(10)
    expect(result.x[19]).toBe(29)
    expect(result.y[0]).toBe(100)
  })

  test(`routes .brml to the ZIP parser`, async () => {
    const xml = `<RawData><Start>10</Start><Step>10</Step><Intensities>100 200</Intensities></RawData>`
    const files = { 'RawData0.xml': new TextEncoder().encode(xml) }
    expect(await parse_xrd_file(zipSync(files).buffer, `scan.brml`)).toEqual({
      x: [10, 20],
      y: [50, 100],
    })
  })

  test.each([`data.pdf`, `datafile`])(`rejects %s`, async (filename) => {
    await expect(parse_xrd_file(xy, filename)).rejects.toThrow(
      /Unsupported XRD file extension/,
    )
  })
})

describe(`is_xrd_data_file`, () => {
  test.each([
    [`sample.xy`, true],
    [`SCAN.BRML`, true],
    [`rigaku.ras.gz`, true],
    [`bruker.raw`, true],
    [`fullprof.fxye`, true],
    [`data.cif`, false],
    [`noextension`, false],
    [`data.gz`, false], // .gz alone is not a format
  ])(`%s → %s`, (filename, expected) => expect(is_xrd_data_file(filename)).toBe(expected))
})

// The site's example files, with the 2θ grid each format encodes. A parser that silently fell
// back to a default start/step (as the .asc, .dat and .raw paths once did) still produced a
// "pattern" with max 100, which is why every row pins the first and last angle.
describe(`real example files`, () => {
  const site_xrd_dir = path.resolve(`src/site/xrd`)
  const load = async (filename: string) => {
    let content = fs.readFileSync(path.join(site_xrd_dir, filename))
    const base_name = filename.replace(/\.gz$/i, ``)
    if (filename !== base_name) content = zlib.gunzipSync(content)
    const is_binary = /\.(?:brml|raw)$/i.test(base_name)
    return parse_xrd_file(
      is_binary ? new Uint8Array(content).buffer : content.toString(),
      base_name,
    )
  }

  test.each([
    // [file, first 2θ, last 2θ]
    [`2Theta.asc.gz`, 4, 80], // Rigaku ASC: *START 4, *STOP 80
    [`BT86-siemens.uxd.gz`, 3, 40], // _2THETACOUNTS rows
    [`BT86_.UXD.gz`, 3, 40],
    [`BT86.raw`, 3, 40.0003], // RAW1.01: 2374 steps of 0.0155922° from 3°
    [`Cu3Au-1.raw`, 22, 100], // RAW1.01: 3901 steps of 0.02° from 22°
    [`D1A5.dat.gz`, -10, 157.9], // ILL block: -10 0.1 157.9
    [`PSI_DMC.dat.gz`, 2.948, 162.898], // PSI block: 2.948 0.050 162.898
    [`FAP-laboratory.gsas.gz`, 15, 130.04], // BANK CONST 1500 2: 5753 channels
    [`garnet-neutron.gsas.gz`, 24, 157.9], // BANK CONST 2400 5: 2679 channels
    [`IKZ-Berlin-Si-substrate-2theta-omega-44-48deg.brml`, 44, 48],
    [`MB120718Si3.ras.gz`, 2, 30],
    [`PANalytical-powder-xrd-3-70deg.xrdml`, 3.0084, 70.0038],
    [`YBCO-A1-HG-600C-950C.brml`, 4.9979, 89.9933],
    [`YBCO-B1-BM-600C-950C-20min.brml`, 7.9979, 89.9901],
    [`YBCO-B1-BM-600C-950C.brml`, 4.9979, 89.9933],
    [`aimat-powder-xrd-30-110deg.xy.gz`, 30.0031, 110.0656], // stitched two-range scan
    [`synthetic-quartz-xrd.xye`, 20.85, 136.55],
  ])(`%s spans 2θ = %f … %f`, async (filename, first, last) => {
    const result = await load(filename)
    expect(result.x).toHaveLength(result.y.length)
    expect(result.x.length).toBeGreaterThan(10)
    expect(result.x[0]).toBeCloseTo(first, 3)
    expect(result.x[result.x.length - 1]).toBeCloseTo(last, 3)
    expect(Math.max(...result.y)).toBeCloseTo(100, 9)
    expect(result.y.every(Number.isFinite)).toBe(true)
  })

  // The garnet bank is 10(I2,F6.0) with 1..10 overlapping detectors per point; split on
  // whitespace, the detector counts interleave with the intensities and the 2664-count peak
  // at 71.75° lands at 157.9° (the last channel)
  test(`garnet-neutron.gsas.gz reads fixed-width STD records field by field`, async () => {
    const result = await load(`garnet-neutron.gsas.gz`)
    expect(result.y[0]).toBeCloseTo((162 / 2664) * 100, 9)
    expect(result.x[result.y.indexOf(100)]).toBeCloseTo(71.75, 9)
  })

  test(`every example file is covered above`, () => {
    const files = fs.readdirSync(site_xrd_dir).filter((name) => is_xrd_data_file(name))
    expect(files).toHaveLength(17)
  })

  // The binary RAW1.01 scan and its UXD text export describe the same measurement, so the
  // decoded layout is checked against an independent rendering of the same numbers. UXD
  // rounds 2θ to three decimals, hence the 5e-3 bound on x; y must agree exactly.
  test(`BT86.raw decodes to the same scan as its UXD export`, async () => {
    const [raw, uxd] = await Promise.all([load(`BT86.raw`), load(`BT86-siemens.uxd.gz`)])
    expect(raw.x).toHaveLength(uxd.x.length)
    let max_dx = 0
    for (let idx = 0; idx < raw.x.length; idx++) {
      max_dx = Math.max(max_dx, Math.abs(raw.x[idx] - uxd.x[idx]))
    }
    expect(max_dx).toBeLessThan(5e-3)
    expect(raw.y).toEqual(uxd.y)
  })
})
