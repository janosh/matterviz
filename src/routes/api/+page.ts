import type { SummaryDoc } from '$lib/material'
import { fetch_zipped, mp_build_bucket } from '$lib/mp-api'

export const ssr = false
const mp_build_url =
  `https://materialsproject-build.s3.amazonaws.com?delimiter=%2F&prefix=collections%2F2022-10-28%2F`

async function fetch_bucket_names() {
  const text = await fetch(mp_build_url).then((res) => res.text())

  // mock DOMParser when server-rendering
  if (typeof globalThis.DOMParser === `undefined`) {
    // @ts-expect-error - this is a mock
    globalThis.DOMParser = class {
      parseFromString() {
        return { querySelectorAll: () => [] } // Return a minimal mock object
      }
    }
  }

  const doc = new DOMParser().parseFromString(text, `text/xml`)
  return Array.from(doc.querySelectorAll(`Prefix`))
    .map((el) => el.textContent?.split(`/`)[2])
    .filter(Boolean)
}

export const load = () => {
  const file = `mp-756175.json.gz`
  const summary_url = `${mp_build_bucket}/summary/${file}`

  return {
    summary: fetch_zipped<SummaryDoc>(summary_url),
    buckets: fetch_bucket_names(),
  }
}
