// Agent-facing movie jobs. Uses the same viewer and frame producer as the export pane.
import { chromium } from '@playwright/test'
import { execFile } from 'node:child_process'
import { addAbortSignal, Writable } from 'node:stream'
import {
  readFile,
  writeFile,
  mkdir,
  mkdtemp,
  rm,
  link,
  unlink,
  stat,
  rename,
} from 'node:fs/promises'
import { basename, dirname, resolve, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, promisify } from 'node:util'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    output: { type: `string`, short: `o` },
    url: { type: `string` },
    headed: { type: `boolean` },
    samples: { type: `string`, default: `6` },
    help: { type: `boolean`, short: `h` },
  },
})
const [command, input] = positionals
if (values.help || ![`inspect`, `preview`, `render`].includes(command) || !input) {
  console.log(`Usage: pnpm movie inspect trajectory.h5
       pnpm movie preview movie.json --output storyboard.png
       pnpm movie render movie.json --output movie.mp4
Options: --url http://localhost:3000  --headed  --samples 6
Without --url, starts a private local viewer. Progress is JSON on stderr; results are JSON on stdout.`)
  process.exit(values.help ? 0 : 1)
}

const progress = (event) => process.stderr.write(`${JSON.stringify(event)}\n`)
const exec_file = promisify(execFile)
const root = fileURLToPath(new URL(`../../`, import.meta.url))
let browser
let server
let temporary
let published_plan
const cancellation = new AbortController()
const cancel = () => {
  cancellation.abort()
  void browser?.close()
}
process.once(`SIGINT`, cancel)
process.once(`SIGTERM`, cancel)

try {
  const spec =
    command === `inspect`
      ? { source: { path: resolve(input) } }
      : JSON.parse(await readFile(input, `utf8`))
  if (!spec.source || Boolean(spec.source.path) === Boolean(spec.source.url))
    throw new Error(`Specify exactly one source.path or source.url`)
  if (spec.source.path) {
    const base = command === `inspect` ? process.cwd() : dirname(resolve(input))
    spec.source.path = resolve(base, spec.source.path)
    const file = await stat(spec.source.path)
    spec.source.size_bytes = file.size
    spec.source.modified = file.mtime.toISOString()
  }
  const samples = Number(values.samples)
  if (!Number.isInteger(samples) || samples < 2 || samples > 36)
    throw new Error(`--samples must be in 2..36`)
  const output = values.output && resolve(values.output)
  const review = output && command === `render` ? `${output}.review` : undefined
  if (command !== `inspect` && !output) throw new Error(`--output is required`)
  for (const destination of [output, output && `${output}.json`, review].filter(Boolean)) {
    if (
      await stat(destination).then(
        () => true,
        (error) => {
          if (error.code !== `ENOENT`) throw error
          return false
        },
      )
    )
      throw new Error(`Output already exists: ${destination}`)
  }
  if (output) await mkdir(dirname(output), { recursive: true })
  if (review) await mkdir(review)
  const width = spec.video?.width ?? 1280
  const height = spec.video?.height ?? 720
  let url = values.url
  if (!url) {
    const { createServer } = await import(`vite`)
    server = await createServer({
      root,
      logLevel: `silent`,
      cacheDir: `.svelte-kit/movie-vite`,
      server: { host: `127.0.0.1`, port: 0, open: false },
    })
    await server.listen()
    const address = server.httpServer?.address()
    if (!address || typeof address === `string`) throw new Error(`Viewer server did not start`)
    url = `http://127.0.0.1:${address.port}`
  }
  browser = await chromium.launch({
    channel: `chromium`,
    headless: !values.headed,
    args: [
      `--enable-unsafe-webgpu`,
      `--enable-features=Vulkan`,
      `--enable-unsafe-swiftshader`,
    ],
  })
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1,
    colorScheme: `dark`,
  })
  page.on(`pageerror`, (error) => progress({ stage: `browser-error`, message: error.message }))
  await page.goto(`${url.replace(/\/$/, ``)}/trajectory/render`)
  await page.waitForFunction(() => Boolean(window.matterviz_movie), undefined, {
    timeout: 120_000,
  })
  if (spec.visuals)
    await page.evaluate((options) => window.matterviz_movie.configure(options), spec.visuals)
  progress({ stage: `loading`, source: spec.source })
  if (spec.source?.path) {
    await page.locator(`#movie-source`).setInputFiles(spec.source.path)
  }
  await page.evaluate(async ({ source }) => {
    const file = document.querySelector(`#movie-source`).files?.[0]
    await window.matterviz_movie.load(source.url ?? file, {
      hdf5_group_path: source.hdf5_group_path,
      signal: AbortSignal.timeout(300_000),
    })
  }, spec)
  const info = await page.evaluate(() => window.matterviz_movie.inspect())
  if (command === `inspect`) console.log(JSON.stringify(info, null, 2))
  else {
    // Re-resolve derived timing even when the input is an edited saved plan.
    const plan = await page.evaluate(
      (request) => window.matterviz_movie.plan_movie(request),
      spec,
    )
    const resolved = { source: spec.source, visuals: spec.visuals, ...plan }
    progress({ stage: `planned`, frames: plan.video.frame_count, ...info })
    const started = performance.now()
    temporary = await mkdtemp(`${dirname(output)}/.${basename(output)}-`)
    const partial = `${temporary}/movie${extname(output)}`
    const sample_indices = [
      ...new Set(
        Array.from({ length: samples }, (_unused, idx) =>
          Math.round((idx * (plan.video.frame_count - 1)) / (samples - 1)),
        ),
      ),
    ]
    const latest = review && `${review}/latest.png`
    const storyboard = review && `${review}/storyboard.png`
    if (review) {
      await writeFile(`${review}/plan.json`, JSON.stringify(resolved, null, 2))
      progress({ stage: `review`, plan: `${review}/plan.json`, latest, storyboard })
    }
    let frame_count = 0
    let encoded
    let capture_plan = plan
    let encoding_args
    if (command === `preview`) {
      const preview_width = Math.min(width, 640)
      const preview_height = Math.max(2, 2 * Math.round((height * preview_width) / width / 2))
      capture_plan = {
        ...plan,
        video: {
          ...plan.video,
          width: preview_width,
          height: preview_height,
          fps: samples / plan.video.duration_s,
          frame_count: samples,
        },
      }
      encoding_args = [`-vf`, `tile=3x${Math.ceil(samples / 3)}`, `-frames:v`, `1`]
    } else {
      const { codec = `h264`, crf = 18, preset = `medium`, bitrate } = plan.video
      const encoder_name = { h264: `libx264`, vp9: `libvpx-vp9`, av1: `libsvtav1` }[codec]
      if (!encoder_name) throw new Error(`Unsupported codec: ${codec}`)
      if (!Number.isInteger(crf) || crf < 0 || crf > (codec === `h264` ? 51 : 63))
        throw new Error(`Invalid ${codec} CRF: ${crf}`)
      if (bitrate !== undefined && spec.video.crf !== undefined)
        throw new Error(`Choose bitrate or crf, not both`)
      const quality = bitrate === undefined ? [`-crf`, String(crf)] : [`-b:v`, String(bitrate)]
      const tuning =
        codec === `h264`
          ? [`-preset`, preset]
          : codec === `av1`
            ? [`-preset`, `6`]
            : [`-b:v`, bitrate === undefined ? `0` : String(bitrate)]
      encoding_args = [
        `-c:v`,
        encoder_name,
        ...quality,
        ...tuning,
        `-pix_fmt`,
        `yuv420p`,
        ...(extname(output) === `.mp4` ? [`-movflags`, `+faststart`] : []),
      ]
    }
    await page.exposeFunction(`movie_frame`, async (data, idx) => {
      const bytes = Buffer.from(data.split(`,`)[1], `base64`)
      await writer.write(bytes)
      frame_count++
      if (review && sample_indices.includes(idx)) {
        await writeFile(`${temporary}/latest.png`, bytes)
        await rename(`${temporary}/latest.png`, latest)
        progress({
          stage: `sample`,
          image: latest,
          frame: idx,
          timestamp_s: idx / plan.video.fps,
          source_frame: Math.round(
            plan.frames.start +
              (plan.frames.end - plan.frames.start - 1) *
                (plan.video.frame_count === 1 ? 0 : idx / (plan.video.frame_count - 1)),
          ),
        })
      }
      if (review && frame_count % 30 === 0)
        progress({ stage: `rendering`, done: frame_count, total: plan.video.frame_count })
    })
    const encoding = exec_file(
      `ffmpeg`,
      [
        `-hide_banner`,
        `-loglevel`,
        `error`,
        `-f`,
        `image2pipe`,
        `-framerate`,
        String(capture_plan.video.fps),
        `-i`,
        `pipe:0`,
        `-an`,
        ...encoding_args,
        partial,
      ],
      { signal: cancellation.signal },
    )
    // Close stdin on cancellation: FFmpeg can remain blocked reading it after SIGTERM.
    const writer = Writable.toWeb(
      addAbortSignal(cancellation.signal, encoding.child.stdin),
    ).getWriter()
    await Promise.all([
      encoding,
      page
        .evaluate(
          (movie) =>
            window.matterviz_movie.render_movie(movie, async (canvas, idx) => {
              await window.movie_frame(canvas.toDataURL(`image/png`), idx)
            }),
          capture_plan,
        )
        .then(async () => {
          progress({
            stage: `encoding`,
            done: frame_count,
            total: capture_plan.video.frame_count,
          })
          await writer.close()
        }),
    ])
    if (frame_count !== capture_plan.video.frame_count)
      throw new Error(
        `Expected ${capture_plan.video.frame_count} frames, encoded ${frame_count}`,
      )
    if (command === `render`) {
      progress({ stage: `verifying`, done: frame_count, total: plan.video.frame_count })
      const { stdout, stderr: probe_errors } = await exec_file(
        `ffprobe`,
        [
          `-v`,
          `error`,
          `-count_frames`,
          `-select_streams`,
          `v:0`,
          `-show_entries`,
          `stream=width,height,codec_name,avg_frame_rate,nb_read_frames:format=duration,size`,
          `-of`,
          `json`,
          partial,
        ],
        { signal: cancellation.signal },
      )
      if (probe_errors.trim()) throw new Error(`Video decoding failed: ${probe_errors}`)
      encoded = JSON.parse(stdout)
      const stream = encoded.streams[0]
      if (
        Number(stream.nb_read_frames) !== frame_count ||
        stream.width !== width ||
        stream.height !== height
      )
        throw new Error(`Encoded video does not match the movie plan: ${stdout}`)
      // Matroska timestamps have millisecond resolution; MP4 is generally finer.
      if (Math.abs(Number(encoded.format.duration) - plan.video.duration_s) > 0.001)
        throw new Error(
          `Encoded duration ${encoded.format.duration} differs from ${plan.video.duration_s}`,
        )
      await exec_file(
        `ffmpeg`,
        [
          `-hide_banner`,
          `-loglevel`,
          `error`,
          `-xerror`,
          `-i`,
          partial,
          `-vf`,
          `select=${sample_indices.map((idx) => `eq(n\\,${idx})`).join(`+`)},scale=640:-2,tile=3x${Math.ceil(sample_indices.length / 3)}`,
          `-frames:v`,
          `1`,
          `${temporary}/storyboard.png`,
        ],
        { signal: cancellation.signal },
      )
      await rename(`${temporary}/storyboard.png`, storyboard)
      progress({ stage: `verified`, storyboard, encoded })
    }
    // Publish only completed artifacts and refuse to replace an existing output.
    cancellation.signal.throwIfAborted()
    await writeFile(
      `${temporary}/plan.json`,
      JSON.stringify(
        {
          ...resolved,
          result: {
            output,
            frame_count,
            encoded,
            latest,
            storyboard,
            elapsed_s: (performance.now() - started) / 1000,
          },
        },
        null,
        2,
      ),
      { flag: `wx` },
    )
    await link(`${temporary}/plan.json`, `${output}.json`)
    published_plan = `${output}.json`
    await link(partial, output)
    published_plan = undefined
    console.log(
      JSON.stringify({ output, plan: `${output}.json`, frame_count, latest, storyboard }),
    )
  }
} catch (error) {
  progress({
    stage: cancellation.signal.aborted ? `cancelled` : `error`,
    message: String(error),
  })
  process.exitCode = 1
} finally {
  cancellation.abort()
  await browser?.close()
  await server?.close()
  if (temporary) await rm(temporary, { recursive: true, force: true })
  if (published_plan) await unlink(published_plan)
}
