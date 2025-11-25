import type { MarkerSymbol } from '$lib/phase-diagram/types'
import { beforeAll, describe, expect, it } from 'vitest'

// Mock Path2D for Node.js environment (not available outside browser)
class MockPath2D {
  constructor(_path?: string) {}
  arc(_x: number, _y: number, _r: number, _start: number, _end: number): void {}
}

beforeAll(() => {
  // @ts-expect-error - mocking browser API
  globalThis.Path2D = MockPath2D
})

describe(`create_marker_path`, () => {
  const markers: MarkerSymbol[] = [
    `circle`,
    `star`,
    `triangle`,
    `cross`,
    `diamond`,
    `square`,
    `wye`,
  ]

  it.each(markers)(`creates Path2D for "%s"`, async (marker) => {
    const { create_marker_path } = await import(`$lib/phase-diagram/helpers`)
    expect(create_marker_path(10, marker)).toBeInstanceOf(MockPath2D)
  })

  it(`defaults to circle and handles invalid marker`, async () => {
    const { create_marker_path } = await import(`$lib/phase-diagram/helpers`)
    expect(create_marker_path(10)).toBeInstanceOf(MockPath2D)
    expect(create_marker_path(10, `invalid` as MarkerSymbol)).toBeInstanceOf(MockPath2D)
  })
})
