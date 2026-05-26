import type { COMPRESSION_EXTENSIONS } from '$lib/constants'
import { COMPRESSION_EXTENSIONS_REGEX, COMPRESSION_FORMATS } from '$lib/constants'

export type CompressionFormat = keyof typeof COMPRESSION_FORMATS
export type CompressionExtension = (typeof COMPRESSION_EXTENSIONS)[number]

export function detect_compression_format(filename: string): CompressionFormat | null {
  const lower = filename.toLowerCase()
  for (const [format, extensions] of Object.entries(COMPRESSION_FORMATS)) {
    if (extensions.some((ext) => lower.endsWith(ext))) return format as CompressionFormat
  }
  return null
}

// Decompress data and return as text string
export async function decompress_data(
  data: ArrayBuffer | ReadableStream<Uint8Array> | null,
  format: CompressionFormat,
): Promise<string> {
  const buffer = await decompress_data_binary(data, format)
  return new TextDecoder().decode(buffer)
}

// Decompress data and return as ArrayBuffer (for binary files like .brml.gz)
export async function decompress_data_binary(
  data: ArrayBuffer | ReadableStream<Uint8Array> | null,
  format: CompressionFormat,
): Promise<ArrayBuffer> {
  try {
    // Handle unsupported formats
    if (format === `zip` || format === `xz` || format === `bz2`) {
      throw new Error(
        `${format.toUpperCase()} decompression is not supported in the browser. ` +
          `Please extract the ${format.toUpperCase()} file first.`,
      )
    }

    const stream =
      data instanceof ArrayBuffer
        ? new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array(data))
              controller.close()
            },
          })
        : data
    if (!stream) throw new Error(`Invalid data stream`)
    const unzip = new DecompressionStream(format)
    return await new Response(stream.pipeThrough(unzip)).arrayBuffer()
  } catch (error) {
    throw new Error(`Failed to decompress ${format} file: ${error}`, { cause: error })
  }
}

export function decompress_file(file: File): Promise<{ content: string; filename: string }> {
  const format = detect_compression_format(file.name)
  const is_supported = Boolean(format && ![`zip`, `xz`, `bz2`].includes(format))

  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.addEventListener(
      `load`,
      () => {
        try {
          const result = reader.result
          if (!result) throw new Error(`Failed to read file`)

          if (is_supported && format) {
            if (!(result instanceof ArrayBuffer)) throw new Error(`Expected binary file data`)
            decompress_data(result, format).then((content) => {
              const filename = file.name.replace(COMPRESSION_EXTENSIONS_REGEX, ``)
              resolve({ content, filename })
            }, reject)
          } else {
            if (typeof result !== `string`) throw new Error(`Expected text file data`)
            resolve({ content: result, filename: file.name })
          }
        } catch (error) {
          reject(error)
        }
      },
      { once: true },
    )
    reader.addEventListener(`error`, () =>
      reject(new Error(`Failed to read file ${file.name}`)),
    )

    if (is_supported) reader.readAsArrayBuffer(file)
    else reader.readAsText(file)
  })
}
