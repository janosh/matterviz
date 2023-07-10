import { fetch_zipped, mp_build_bucket } from '$lib/api'
import type { SummaryDoc } from '$lib/material/index'

export const ssr = false
const mp_build_url = `https://materialsproject-build.s3.amazonaws.com?delimiter=%2F&prefix=collections%2F2022-10-28%2F`

async function fetch_bucket_names() {
  const text = await fetch(mp_build_url).then((res) => res.text())
  const doc = new window.DOMParser().parseFromString(text, `text/xml`)
  return [...doc.querySelectorAll(`Prefix`)]
    .map((el) => el.textContent?.split(`/`)[2])
    .filter(Boolean)
}

export const load = async () => {
  const file = `mp-756175.json.gz`
  const summary_url = `${mp_build_bucket}/summary/${file}`

  return {
    summary: fetch_zipped<SummaryDoc>(summary_url),
    buckets: fetch_bucket_names(),
  }
}
