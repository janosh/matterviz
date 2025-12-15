// Tests for Fermi surface export functionality
import { export_scene } from '$lib/fermi-surface/export'
import { describe, expect, it } from 'vitest'

describe(`export_scene`, () => {
  it(`rejects unsupported format`, async () => {
    const mock_scene = { type: `Scene`, children: [] }
    await expect(
      export_scene(mock_scene as never, `xyz` as `stl`, `test`),
    ).rejects.toThrow(`Unsupported export format`)
  })
})
