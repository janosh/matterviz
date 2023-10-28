export const mp_build_bucket = `https://materialsproject-build.s3.amazonaws.com/collections/2022-10-28`

export async function decompress(blob: ReadableStream<Uint8Array> | null) {
  // @ts-expect-error - TS doesn't know about DecompressionStream yet
  const unzip = new DecompressionStream(`gzip`)
  const stream = blob.pipeThrough(unzip)
  return await new Response(stream).text()
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
  return JSON.parse(await decompress(response.body))
}

// Function to download data to a file
export function download(data: string | Blob, filename: string, type: string) {
  const file = new Blob([data], { type })
  const link = document.createElement(`a`)
  const url = URL.createObjectURL(file)
  link.style.display = `none`
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // raises 'is not a function' error in JSDOM
  // URL.revokeObjectURL(url)
}
