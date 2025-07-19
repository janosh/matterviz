import { describe, expect, test } from 'vitest'

// Local implementation of base64_to_array_buffer for testing
// This matches the implementation in webview/src/main.ts
function base64_to_array_buffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let idx = 0; idx < binary.length; idx++) {
    bytes[idx] = binary.charCodeAt(idx)
  }
  return bytes.buffer
}

describe(`Webview Integration - ASE Binary Trajectory Support`, () => {
  test.each([
    [`SGVsbG8gV29ybGQ=`, `Hello World`, 11], // Basic ASCII
    [`QUJDREVGR0g=`, `ABCDEFGH`, 8], // Another ASCII
    [``, ``, 0], // Empty string
    [`QQ==`, `A`, 1], // Single character
    [`QUI=`, `AB`, 2], // Two characters
  ])(
    `base64_to_array_buffer: %s → %s (%i bytes)`,
    (base64, expected, byte_length) => {
      const result = base64_to_array_buffer(base64)
      expect(result).toBeInstanceOf(ArrayBuffer)
      expect(result.byteLength).toBe(byte_length)
      expect(new TextDecoder().decode(result)).toBe(expected)
    },
  )

  test(`base64_to_array_buffer handles ASE trajectory file header correctly`, () => {
    const ase_header = new Uint8Array([
      0x2d,
      0x20,
      0x6f,
      0x66,
      0x20,
      0x55,
      0x6c,
      0x6d,
      0x41,
      0x53,
      0x45,
      0x2d,
      0x54,
      0x72,
      0x61,
      0x6a,
    ])
    const base64 = btoa(String.fromCharCode(...ase_header))
    const result = base64_to_array_buffer(base64)

    expect(result.byteLength).toBe(ase_header.length)
    expect(Array.from(new Uint8Array(result))).toEqual(Array.from(ase_header))
    expect(new TextDecoder().decode(result.slice(0, 8))).toBe(`- of Ulm`)
  })

  test(`base64_to_array_buffer preserves byte order and handles performance`, () => {
    // Test byte order preservation
    const test_bytes = new Uint8Array([
      0x00,
      0x01,
      0x02,
      0x03,
      0xFF,
      0xFE,
      0xFD,
      0xFC,
    ])
    const base64 = btoa(String.fromCharCode(...test_bytes))
    const result = base64_to_array_buffer(base64)
    expect(Array.from(new Uint8Array(result))).toEqual(Array.from(test_bytes))

    // Test performance with large data
    const large_data = new Uint8Array(10000).fill(42)
    const large_base64 = btoa(String.fromCharCode(...large_data))
    const start = performance.now()
    const large_result = base64_to_array_buffer(large_base64)
    expect(performance.now() - start).toBeLessThan(100)
    expect(large_result.byteLength).toBe(large_data.length)
    const result_array = new Uint8Array(large_result)
    expect(result_array[0]).toBe(42)
    expect(result_array[result_array.length - 1]).toBe(42)
  })

  test.each([1024, 8192, 32768])(
    `handles typical ASE trajectory file size: %i bytes`,
    (size) => {
      const data = new Uint8Array(size)
      for (let i = 0; i < size; i++) data[i] = i % 256

      const base64 = btoa(String.fromCharCode(...data))
      const result = base64_to_array_buffer(base64)
      const result_array = new Uint8Array(result)

      expect(result.byteLength).toBe(size)
      expect(result_array[0]).toBe(0)
      expect(result_array[255]).toBe(255)
      expect(result_array[size - 1]).toBe((size - 1) % 256)
    },
  )

  test(`ASE trajectory file regression test - simulates VS Code extension flow`, () => {
    // ASE signature + tag
    const ase_data = new Uint8Array([
      0x2d,
      0x20,
      0x6f,
      0x66,
      0x20,
      0x55,
      0x6c,
      0x6d, // "- of Ulm"
      0x41,
      0x53,
      0x45,
      0x2d,
      0x54,
      0x72,
      0x61,
      0x6a,
      0x65,
      0x63,
      0x74,
      0x6f,
      0x72,
      0x79,
      0x00,
      0x00, // "ASE-Trajectory"
      ...new Array(176).fill(0), // Mock trajectory data
    ])

    const base64_content = btoa(String.fromCharCode(...ase_data))
    const result = base64_to_array_buffer(base64_content)
    const result_array = new Uint8Array(result)

    expect(result.byteLength).toBe(ase_data.length)
    expect(new TextDecoder().decode(result_array.slice(0, 8))).toBe(`- of Ulm`)
    expect(
      new TextDecoder().decode(result_array.slice(8, 24)).replace(/\0/g, ``),
    ).toBe(`ASE-Trajectory`)
  })
})
