import { download, fetch_zipped } from '$lib/io/fetch'
import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock(`$lib/io/decompress`, () => ({ decompress_data: vi.fn() }))
globalThis.fetch = vi.fn()

// Mock DOM elements and methods
const mock_create_element = vi.fn()
const mock_append_child = vi.fn()
const mock_click = vi.fn()
const mock_remove = vi.fn()
const mock_create_object_url = vi.fn()
const mock_revoke_object_url = vi.fn()

describe(`fetch_zipped`, () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset globalThis.download
    delete (globalThis as Record<string, unknown>).download
  })

  test(`fetches and decompresses data successfully`, async () => {
    const mock_data = { test: `data` }
    const mock_response = {
      ok: true,
      body: `compressed_data`,
      url: `https://example.com/test.json.gz`,
    } as unknown as Response
    vi.mocked(fetch).mockResolvedValue(mock_response)
    const { decompress_data } = await import(`$lib/io/decompress`)
    vi.mocked(decompress_data).mockResolvedValue(JSON.stringify(mock_data))

    const result = await fetch_zipped(`https://example.com/test.json.gz`)

    expect(fetch).toHaveBeenCalledWith(`https://example.com/test.json.gz`)
    expect(decompress_data).toHaveBeenCalledWith(`compressed_data`, `gzip`)
    expect(result).toEqual(mock_data)
  })

  test(`returns null when response is not ok`, async () => {
    const mock_response = {
      ok: false,
      status: 404,
      statusText: `Not Found`,
      url: `https://example.com/notfound.json.gz`,
    } as unknown as Response
    vi.mocked(fetch).mockResolvedValue(mock_response)
    const console_spy = vi.spyOn(console, `error`).mockImplementation(() => {})

    const result = await fetch_zipped(`https://example.com/notfound.json.gz`)

    expect(result).toBeNull()
    expect(console_spy).toHaveBeenCalledWith(
      `404 Not Found for https://example.com/notfound.json.gz`,
    )
    console_spy.mockRestore()
  })

  test(`returns blob when unzip is false`, async () => {
    const mock_blob = new Blob([`test data`], { type: `application/json` })
    const mock_response = {
      ok: true,
      blob: () => Promise.resolve(mock_blob),
    } as unknown as Response
    vi.mocked(fetch).mockResolvedValue(mock_response)

    const result = await fetch_zipped(`https://example.com/test.json`, { unzip: false })

    expect(result).toBe(mock_blob)
  })

  test(`handles JSON parsing errors`, async () => {
    const mock_response = { ok: true, body: `compressed_data` } as unknown as Response
    vi.mocked(fetch).mockResolvedValue(mock_response)
    const { decompress_data } = await import(`$lib/io/decompress`)
    vi.mocked(decompress_data).mockResolvedValue(`invalid json`)

    await expect(fetch_zipped(`https://example.com/test.json.gz`)).rejects.toThrow()
  })
})

describe(`download`, () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Mock DOM elements
    mock_create_element.mockReturnValue({
      style: {},
      href: ``,
      download: ``,
      click: mock_click,
      remove: mock_remove,
    })

    // Mock document methods
    Object.defineProperty(document, `createElement`, {
      value: mock_create_element,
      writable: true,
    })
    Object.defineProperty(document.body, `appendChild`, {
      value: mock_append_child,
      writable: true,
    })

    // Mock URL methods
    Object.defineProperty(globalThis, `URL`, {
      value: {
        createObjectURL: mock_create_object_url,
        revokeObjectURL: mock_revoke_object_url,
      },
      writable: true,
    })
    mock_create_object_url.mockReturnValue(`blob:mock-url`)
  })

  test(`downloads string data using default browser download`, () => {
    download(`test data`, `test.txt`, `text/plain`)

    expect(mock_create_element).toHaveBeenCalledWith(`a`)
    expect(mock_append_child).toHaveBeenCalled()
    expect(mock_click).toHaveBeenCalled()
    expect(mock_remove).toHaveBeenCalled()
    expect(mock_create_object_url).toHaveBeenCalled()
    expect(mock_revoke_object_url).toHaveBeenCalledWith(`blob:mock-url`)
  })

  test(`downloads blob data using default browser download`, () => {
    const data = new Blob([`test data`], { type: `text/plain` })
    download(data, `test.txt`, `text/plain`)

    expect(mock_create_element).toHaveBeenCalledWith(`a`)
    expect(mock_append_child).toHaveBeenCalled()
    expect(mock_click).toHaveBeenCalled()
    expect(mock_remove).toHaveBeenCalled()
    expect(mock_create_object_url).toHaveBeenCalled()
    expect(mock_revoke_object_url).toHaveBeenCalledWith(`blob:mock-url`)
  })

  test(`uses global download override when available`, () => {
    const mock_global_download = vi.fn()
    ;(globalThis as Record<string, unknown>).download = mock_global_download

    download(`test data`, `test.txt`, `text/plain`)

    expect(mock_global_download).toHaveBeenCalledWith(
      `test data`,
      `test.txt`,
      `text/plain`,
    )
    expect(mock_create_element).not.toHaveBeenCalled()
  })
})
