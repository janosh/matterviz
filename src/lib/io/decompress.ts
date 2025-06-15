// Browser-supported compression formats and their file extensions
const COMPRESSION_FORMATS = {
  gzip: [`.gz`, `.gzip`],
  deflate: [`.deflate`],
  'deflate-raw': [`.z`],
} as const

export type CompressionFormat = keyof typeof COMPRESSION_FORMATS

export function is_compressed_file(filename: string): boolean {
  return Object.values(COMPRESSION_FORMATS)
    .flat()
    .some((ext) => filename.endsWith(ext))
}

export function remove_compression_extension(filename: string): string {
  const extensions = Object.values(COMPRESSION_FORMATS)
    .flat()
    .map((ext) => ext.slice(1))
  return filename.replace(new RegExp(`\\.(${extensions.join(`|`)})$`), ``)
}

export function detect_compression_format(
  filename: string,
): CompressionFormat | null {
  for (const [format, extensions] of Object.entries(COMPRESSION_FORMATS)) {
    if (extensions.some((ext) => filename.endsWith(ext))) {
      return format as CompressionFormat
    }
  }
  return null
}

export async function decompress_data(
  data: ArrayBuffer,
  format: CompressionFormat,
): Promise<string> {
  if (!(`DecompressionStream` in window)) {
    throw `DecompressionStream API not supported`
  }

  try {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(data))
        controller.close()
      },
    })

    return await new Response(
      stream.pipeThrough(new DecompressionStream(format)),
    ).text()
  } catch (error) {
    throw `Failed to decompress ${format} file: ${error}`
  }
}

// Legacy compatibility
export const decompress_gzip = (data: ArrayBuffer) => decompress_data(data, `gzip`)

export function decompress_file(
  file: File,
): Promise<{ content: string; filename: string }> {
  const compressed = is_compressed_file(file.name)

  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = async (event) => {
      try {
        const result = event.target?.result
        if (!result) throw `Failed to read file`

        if (compressed) {
          const format = detect_compression_format(file.name)
          if (!format) throw `Unsupported compression format: ${file.name}`

          const content = await decompress_data(result as ArrayBuffer, format)
          resolve({
            content,
            filename: remove_compression_extension(file.name),
          })
        } else {
          resolve({ content: result as string, filename: file.name })
        }
      } catch (error) {
        reject(error)
      }
    }

    reader.onerror = () => reject(new Error(`Failed to read file`))

    if (compressed) reader.readAsArrayBuffer(file)
    else reader.readAsText(file)
  })
}
