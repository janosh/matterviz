// deno-lint-ignore-file no-await-in-loop
import {
  decode_structure_id,
  detect_provider_from_slug,
  encode_structure_id,
} from '$lib/api/optimade'
import { describe, expect, test } from 'vitest'

describe(`OPTIMADE API utilities`, () => {
  test.each([
    [`mp-123`],
    [`odbx.9`],
    [`odbx/9`],
    [`odbx-9.1/2`],
    [`odbx 9`],
    [`odbx-9-αβγ`],
    [`odbx-9?param=value`],
    [`odbx-9#fragment`],
    [`odbx.9/1.2`],
    [`odbx.9.1.2.3`],
    [`mp-1226325`],
    [`odbx+9`],
    [`odbx%25`],
    [`me:42`],
    [`user@id`],
    [``],
  ])(`should round-trip encode/decode: %s`, (id) => {
    const encoded = encode_structure_id(id)
    const decoded = decode_structure_id(encoded)
    expect(decoded).toBe(id)
  })

  test(`should encode dots as %2E`, () => {
    const id_with_dots = `odbx.9.1.2`
    const encoded = encode_structure_id(id_with_dots)
    // Case-insensitive check for %2e and verify count matches original dots
    const dotCount = id_with_dots.match(/\./g)?.length ?? 0
    const encodedDotCount = encoded.match(/%2e/gi)?.length ?? 0
    expect(encodedDotCount).toBe(dotCount)
    expect(encoded).not.toContain(`.`)
  })

  test(`should encode forward slashes as %2F`, () => {
    const id_with_slashes = `odbx/9/1.2`
    const encoded = encode_structure_id(id_with_slashes)
    expect(encoded).toContain(`%2F`)
    expect(encoded).not.toContain(`/`)
  })

  test(`should handle complex IDs`, () => {
    const complex_id = `odbx.9/1.2-3_4?param=value#fragment`
    const encoded = encode_structure_id(complex_id)
    const decoded = decode_structure_id(encoded)
    expect(decoded).toBe(complex_id)
  })

  test(`should extract provider prefix from slug`, async () => {
    const cases = [`odbx-9.1`, `mp-1226325`]
    for (const slug of cases) {
      const decoded = decode_structure_id(slug)
      const provider = await detect_provider_from_slug(decoded)
      expect(provider).toBe(slug.split(`-`)[0].toLowerCase())
    }
  })

  test.each([
    [`odbx-9.1`, `odbx`],
    [`mp-123`, `mp`],
    [`cod-456`, `cod`],
    [`odbx-9.1/2`, `odbx`], // Test encoded slug
  ])(`should detect provider %s from slug %s`, async (slug, expected_provider) => {
    const provider = await detect_provider_from_slug(slug)
    expect(provider).toBe(expected_provider)
  })

  test.each([
    [`unknown-123`, `unknown provider`],
    [`123`, `slug without provider prefix`],
  ])(`should return empty string for %s`, async (slug) => {
    const provider = await detect_provider_from_slug(slug)
    expect(provider).toBe(``)
  })
})
