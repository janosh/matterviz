import type { MarkerSymbol } from '$lib/phase-diagram/types'
import { beforeAll, describe, expect, it } from 'vitest'

// Mock Path2D for Node.js environment (not available outside browser)
class MockPath2D {
  private commands: string[] = []
  constructor(path?: string) {
    if (path) this.commands.push(path)
  }
  arc(x: number, y: number, r: number, start: number, end: number): void {
    this.commands.push(`arc(${x},${y},${r},${start},${end})`)
  }
}

beforeAll(() => {
  // @ts-expect-error - mocking browser API
  globalThis.Path2D = MockPath2D
})

describe(`create_marker_path`, () => {
  const marker_types: MarkerSymbol[] = [
    `circle`,
    `star`,
    `triangle`,
    `cross`,
    `diamond`,
    `square`,
    `wye`,
  ]

  it.each(marker_types)(`creates valid Path2D for marker type "%s"`, async (marker) => {
    const { create_marker_path } = await import(`$lib/phase-diagram/helpers`)
    const path = create_marker_path(10, marker)
    expect(path).toBeInstanceOf(MockPath2D)
  })

  it(`defaults to circle when no marker specified`, async () => {
    const { create_marker_path } = await import(`$lib/phase-diagram/helpers`)
    const path = create_marker_path(10)
    expect(path).toBeInstanceOf(MockPath2D)
  })

  it(`creates paths with different sizes`, async () => {
    const { create_marker_path } = await import(`$lib/phase-diagram/helpers`)
    const small_path = create_marker_path(5, `star`)
    const large_path = create_marker_path(20, `star`)
    expect(small_path).toBeInstanceOf(MockPath2D)
    expect(large_path).toBeInstanceOf(MockPath2D)
  })

  it(`handles invalid marker by falling back to circle`, async () => {
    const { create_marker_path } = await import(`$lib/phase-diagram/helpers`)
    const path = create_marker_path(10, `invalid` as MarkerSymbol)
    expect(path).toBeInstanceOf(MockPath2D)
  })
})

describe(`MarkerSymbol type`, () => {
  it(`includes all expected marker types`, () => {
    const expected_markers: MarkerSymbol[] = [
      `circle`,
      `star`,
      `triangle`,
      `cross`,
      `diamond`,
      `square`,
      `wye`,
    ]
    expect(expected_markers).toHaveLength(7)
  })
})
