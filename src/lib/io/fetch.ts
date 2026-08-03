// Convert params object to URL query string, omitting empty/undefined values.
// Example: {foo: "bar", baz: 42, empty: ""} → "foo=bar&baz=42"
export const to_query = (params: Record<string, string | number | undefined>): string =>
  new URLSearchParams(
    Object.entries(params)
      .filter(([, val]) => val !== `` && val !== undefined)
      .map(([key, val]) => [key, String(val)]),
  ).toString()

export type DownloadData = string | Blob | ArrayBuffer | ArrayBufferView<ArrayBuffer>

// Original download implementation
function default_download(data: DownloadData, filename: string, type: string) {
  const file = new Blob([data], { type })
  const link = document.createElement(`a`)
  const url = URL.createObjectURL(file)
  link.href = url
  link.download = filename
  // A detached anchor keeps its synthetic click away from document-level dismissal handlers.
  try {
    link.click()
  } finally {
    URL.revokeObjectURL(url)
  }
}

// Function to download data to a file - checks for global override first
export function download(data: DownloadData, filename: string, type: string): void {
  // Check if there's a global download override (used by VSCode extension)
  const global_download = (globalThis as Record<string, unknown>).download
  if (typeof global_download === `function` && global_download !== download) {
    return (global_download as typeof download)(data, filename, type)
  }

  // Use default browser download
  return default_download(data, filename, type)
}
