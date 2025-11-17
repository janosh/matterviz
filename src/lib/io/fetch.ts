import { decompress_data } from '$lib/io/decompress'

// Convert params object to URL query string, omitting empty/undefined values.
// Example: {foo: "bar", baz: 42, empty: ""} → "foo=bar&baz=42"
export const to_query = (
  params: Record<string, string | number | undefined>,
): string => {
  const url_params = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== `` && value !== undefined) url_params.set(key, String(value))
  }
  return url_params.toString()
}

export async function fetch_zipped<T>(
  url: string,
  { unzip = true } = {},
): Promise<T | null> {
  const response = await fetch(url)
  if (!response.ok) {
    console.error(
      `${response.status} ${response.statusText} for ${response.url}`,
    )
    return null
  }
  if (!unzip) return (await response.blob()) as T
  return JSON.parse(await decompress_data(response.body, `gzip`))
}

// Original download implementation
function default_download(data: string | Blob, filename: string, type: string) {
  const file = new Blob([data], { type })
  const link = document.createElement(`a`)
  const url = URL.createObjectURL(file)
  link.style.display = `none`
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

// Function to download data to a file - checks for global override first
export function download(data: string | Blob, filename: string, type: string): void {
  // Check if there's a global download override (used by VSCode extension)
  const global_download = (globalThis as Record<string, unknown>).download
  if (typeof global_download === `function` && global_download !== download) {
    return (global_download as typeof download)(data, filename, type)
  }

  // Use default browser download
  return default_download(data, filename, type)
}
