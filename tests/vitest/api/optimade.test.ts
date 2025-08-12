import { decode_structure_id, encode_structure_id } from '$lib/api/optimade'
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
    [``],
  ])(`should round-trip encode/decode: %s`, (id) => {
    const encoded = encode_structure_id(id)
    const decoded = decode_structure_id(encoded)
    expect(decoded).toBe(id)
  })

  test(`should encode dots as %2E`, () => {
    const id_with_dots = `odbx.9.1.2`
    const encoded = encode_structure_id(id_with_dots)
    expect(encoded).toContain(`%2E`)
    expect(encoded).not.toContain(`.`)
  })

  test(`should handle complex IDs`, () => {
    const complex_id = `odbx.9/1.2-3_4?param=value#fragment`
    const encoded = encode_structure_id(complex_id)
    const decoded = decode_structure_id(encoded)
    expect(decoded).toBe(complex_id)
  })

  test(`should extract provider prefix from slug`, () => {
    const slug = `odbx-9.1`
    const decoded_slug = decode_structure_id(slug)
    const prefix = decoded_slug.split(`-`)[0].toLowerCase()
    expect(prefix).toBe(`odbx`)
  })

  test(`should handle encoded slugs`, () => {
    const encoded_slug = encode_structure_id(`odbx-9.1/2`)
    const decoded_slug = decode_structure_id(encoded_slug)
    const prefix = decoded_slug.split(`-`)[0].toLowerCase()
    expect(prefix).toBe(`odbx`)
  })
})
