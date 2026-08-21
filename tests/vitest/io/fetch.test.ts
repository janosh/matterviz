import { download } from '$lib/io/fetch'
import { afterEach, describe, expect, test, vi } from 'vitest'

afterEach(() => vi.restoreAllMocks())

describe(`download`, () => {
  test(`keeps its link detached and releases browser resources when clicking throws`, () => {
    const revoke_url = vi.spyOn(URL, `revokeObjectURL`).mockImplementation(() => {})
    vi.spyOn(URL, `createObjectURL`).mockReturnValue(`blob:test`)
    const append_link = vi.spyOn(Element.prototype, `append`)
    vi.spyOn(HTMLAnchorElement.prototype, `click`).mockImplementation(() => {
      throw new Error(`click failed`)
    })

    expect(() => download(`content`, `test.txt`, `text/plain`)).toThrow(`click failed`)
    expect(append_link).not.toHaveBeenCalled()
    expect(revoke_url).toHaveBeenCalledExactlyOnceWith(`blob:test`)
  })
})
