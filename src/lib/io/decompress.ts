// compression formats and their file extensions
const COMPRESSION_FORMATS = {
  gzip: [`.gz`, `.gzip`],
  deflate: [`.deflate`],
  'deflate-raw': [`.z`],
  zip: [`.zip`], // Browser DecompressionStream doesn't support ZIP
  xz: [`.xz`], // Browser DecompressionStream doesn't support XZ
  bz2: [`.bz2`], // Browser DecompressionStream doesn't support BZ2
} as const

export type CompressionFormat = keyof typeof COMPRESSION_FORMATS

// All detectable compression extensions
export const COMPRESSION_EXTENSIONS = [
  ...Object.values(COMPRESSION_FORMATS).flat(),
] as const

export type CompressionExtension = (typeof COMPRESSION_EXTENSIONS)[number]

export function remove_compression_extension(filename: string): string {
  const extensions = COMPRESSION_EXTENSIONS.map((ext) => ext.slice(1))
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
  data: ArrayBuffer | ReadableStream<Uint8Array> | null,
  format: CompressionFormat,
): Promise<string> {
  try {
    // Handle unsupported formats
    if (format === `zip` || format === `xz` || format === `bz2`) {
      throw new Error(
        `${format.toUpperCase()} decompression is not supported in the browser. Please extract the ${format.toUpperCase()} file first.`,
      )
    }

    const stream = data instanceof ArrayBuffer
      ? new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(data))
          controller.close()
        },
      })
      : data
    const unzip = new DecompressionStream(format)
    return await new Response(stream?.pipeThrough(unzip)).text()
  } catch (error) {
    throw `Failed to decompress ${format} file: ${error}`
  }
}

export function decompress_file(
  file: File,
): Promise<{ content: string; filename: string }> {
  const format = detect_compression_format(file.name)
  const compressed = format && format !== `zip` && format !== `xz` && format !== `bz2` // Treat unsupported as uncompressed

  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onload = async (event) => {
      try {
        const result = event.target?.result
        if (!result) throw `Failed to read file`

        if (compressed) {
          const content = await decompress_data(result as ArrayBuffer, format)
          const filename = remove_compression_extension(file.name)
          resolve({ content, filename })
        } else {
          resolve({ content: result as string, filename: file.name })
        }
      } catch (error) {
        reject(error)
      }
    }

    reader.onerror = () => reject(new Error(`Failed to read file ${file.name}`))

    if (compressed) reader.readAsArrayBuffer(file)
    else reader.readAsText(file)
  })
}
