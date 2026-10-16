import { load } from 'js-yaml'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { expect, onTestFinished, test, vi } from 'vitest'

type Gate = {
  if: string
  needs: string[] | string
  steps: { run: string; env: { RESULT: string } }[]
}
const { jobs, concurrency } = load(readFileSync(`.github/workflows/ci.yml`, `utf8`)) as {
  jobs: Record<string, Gate>
  concurrency: { group: string; 'cancel-in-progress': string }
}

// Workflow expressions here use only property access, (in)equality, parentheses and &&/||,
// which JS and Actions evaluate alike (single-quoted strings, `needs.job-name` aside).
const eval_expr = (expression: string, context: Record<string, unknown>) =>
  runInNewContext(
    expression.replaceAll(/needs\.(?<job>[\w-]+)/g, (_, name: string) => `needs["${name}"]`),
    context,
  )

test.each([
  [`CI`, 465, `opened`, `CI-465`, true],
  [`CI`, 465, `synchronize`, `CI-465-sync`, true],
  [`CI`, undefined, undefined, `CI-refs/heads/feature`, true],
  [`Publish`, undefined, undefined, `Publish-123`, false],
])(
  `%s cancellation with PR %s (%s) respects the caller`,
  (workflow, pr_number, action, group, cancel) => {
    // workflow_dispatch is also the event inside a manually dispatched reusable release gate.
    // Synchronize runs get their own group so they never cancel an opened/reopened E2E run.
    const github = {
      workflow,
      event_name: `workflow_dispatch`,
      event: { action, pull_request: { number: pr_number } },
      ref: `refs/heads/feature`,
      run_id: 123,
    }
    const evaluate = (template: string) =>
      template.replaceAll(/\$\{\{(?<expression>.+?)\}\}/g, (_match, expression: string) =>
        String(eval_expr(expression, { github })),
      )
    expect(evaluate(concurrency.group)).toBe(group)
    expect(evaluate(concurrency[`cancel-in-progress`])).toBe(String(cancel))
    github.run_id = 456
    expect(evaluate(concurrency.group)).toBe(workflow === `CI` ? group : `Publish-456`)
  },
)

test.each([
  [`unit-tests`, [`unit-test-shards`, `publint`], []],
  [`e2e-tests`, [`e2e-test-shards`, `e2e-source`], [`e2e-gate`]],
])(`%s requires every test job to succeed`, (gate_name, dependencies, deciders) => {
  const gate = jobs[gate_name]
  expect(gate.if).toBe(`always()`)
  expect(gate.needs).toEqual([...deciders, ...dependencies])
  const [step] = gate.steps
  const gate_status = (results: Record<string, string>, run_e2e: string) => {
    const needs = Object.fromEntries([
      [`e2e-gate`, { result: `success`, outputs: { run: run_e2e } }],
      ...dependencies.map((name) => [name, { result: results[name] ?? `success` }]),
    ])
    const result = eval_expr(step.env.RESULT.slice(3, -2), { needs })
    return spawnSync(`bash`, [`-e`, `-c`, step.run], {
      env: { ...process.env, RESULT: String(result) },
    }).status
  }
  // a failed e2e-gate leaves its output empty (``): skipped E2E must fail then too
  for (const run_e2e of [`true`, `false`, ``]) {
    for (const dependency of dependencies) {
      for (const result of [`success`, `failure`, `cancelled`, `skipped`, ``]) {
        const status = gate_status({ [dependency]: result }, run_e2e)
        expect(status, `run=${run_e2e} ${dependency}: ${result}`).toBe(
          result === `success` ? 0 : 1,
        )
      }
    }
    // E2E is skipped on purpose only where e2e-gate says so; anywhere else skipping means a
    // failed upstream job (e.g. build-site) and must fail the required check.
    const all_skipped = Object.fromEntries(dependencies.map((name) => [name, `skipped`]))
    const skip_ok = gate_name === `e2e-tests` && run_e2e === `false`
    expect(gate_status(all_skipped, run_e2e), `run=${run_e2e}: all skipped`).toBe(
      skip_ok ? 0 : 1,
    )
  }
})

test.each([`true`, `false`, ``])(`E2E jobs run only when e2e-gate outputs run=%j`, (run) => {
  const needs = { 'e2e-gate': { outputs: { run } } }
  for (const job of [`build-site`, `e2e-source`]) {
    expect(jobs[job].needs, job).toBe(`e2e-gate`)
    expect(eval_expr(jobs[job].if, { needs }), job).toBe(run === `true`)
  }
  // Production shards inherit the skip from build-site.
  expect(jobs[`e2e-test-shards`].if).toBeUndefined()
  expect(jobs[`e2e-test-shards`].needs).toBe(`build-site`)
})

// Past CI runs (newest first) as [run id, head repo, E2E gate conclusion, event (default
// pull_request)]; run 100 is this one
const fork = `someone/matterviz`
const own = `janosh/matterviz`
type PastRun = [number, string, string, string?]
// oxfmt-ignore
test.each<[string, string | undefined, PastRun[], boolean]>([
  [`opened`, `opened`, [[3, own, `success`]], true],
  [`merge to main`, undefined, [[3, own, `success`]], true],
  [`first push, nothing decided yet`, `synchronize`, [], true],
  [`last decided gate passed`, `synchronize`, [[3, own, `success`], [2, own, `failure`]], false],
  [`last decided gate failed`, `synchronize`, [[3, own, `failure`], [2, own, `success`]], true],
  // cancelled runs, this run and a fork's same-named branch decide nothing; older runs do
  [`cancelled after a pass`, `synchronize`, [[9, own, `cancelled`], [3, own, `success`]], false],
  [`cancelled after a failure`, `synchronize`, [[9, own, `cancelled`], [3, own, `failure`]], true],
  [`only the current run`, `synchronize`, [[100, own, `success`]], true],
  [`a fork's same-named branch`, `synchronize`, [[4, fork, `success`], [3, own, `failure`]], true],
  // a manually dispatched full run decides like a PR run; other events (push) decide nothing
  [`a dispatched run failed`, `synchronize`, [[5, own, `failure`, `workflow_dispatch`], [3, own, `success`]], true],
  [`a dispatched run passed`, `synchronize`, [[5, own, `success`, `workflow_dispatch`], [3, own, `failure`]], false],
  [`a push run`, `synchronize`, [[5, own, `failure`, `push`], [3, own, `success`]], false],
])(`e2e-gate decides whether E2E runs: %s`, (_label, action, runs, expected) => {
  const [step] = jobs[`e2e-gate`].steps
  const scratch = mkdtempSync(join(tmpdir(), `matterviz-e2e-gate-`))
  onTestFinished(() => rmSync(scratch, { recursive: true, force: true }))
  // GitHub's API as JSON files, filtered by the workflow's own --jq expressions via real jq
  const workflow_runs = runs.map(([id, full_name, , event = `pull_request`]) => ({
    id,
    event,
    head_repository: { full_name },
  }))
  writeFileSync(join(scratch, `runs.json`), JSON.stringify({ workflow_runs }))
  for (const [id, , conclusion] of runs) {
    const jobs_json = [
      { name: `Unit tests`, conclusion: `failure` },
      { name: `E2E tests (shard 1/4)`, conclusion },
    ]
    writeFileSync(join(scratch, `jobs-${id}.json`), JSON.stringify({ jobs: jobs_json }))
  }
  // logs each call's endpoint, then answers with jq over the matching file
  const gh_stub = `gh() {
    echo "$1 $2 $3" >> "${scratch}/calls"
    if [[ "$2" == */jobs?per_page=100 ]]; then id="\${2%/jobs?per_page=100}"; jq -r "$4" "${scratch}/jobs-\${id##*/}.json"; return; fi
    jq -r "$4" "${scratch}/runs.json"
  }`
  const output_file = join(scratch, `output`)
  writeFileSync(output_file, ``)
  const { status, stderr } = spawnSync(`bash`, [`-e`, `-c`, `${gh_stub}\n${step.run}`], {
    encoding: `utf8`,
    env: {
      ...process.env,
      ACTION: action ?? ``,
      HEAD_REPO: own,
      HEAD_REF: `feature`,
      GITHUB_REPOSITORY: own,
      GITHUB_RUN_ID: `100`,
      GITHUB_OUTPUT: output_file,
    },
  })
  expect(status, stderr).toBe(0)
  expect(readFileSync(output_file, `utf8`)).toBe(`run=${expected}\n`)
  // only pushes ask the API: completed runs of this branch, then the jobs of each PR or
  // dispatched run until one decides
  const calls = action === `synchronize` ? readFileSync(join(scratch, `calls`), `utf8`) : ``
  const listed = runs.filter(
    ([id, repo, , event = `pull_request`]) =>
      id !== 100 && repo === own && [`pull_request`, `workflow_dispatch`].includes(event),
  )
  const decided = listed.findIndex(([, , gate]) => gate !== `cancelled`)
  const queried = listed.slice(0, decided === -1 ? listed.length : decided + 1)
  expect(calls.trim().split(`\n`).filter(Boolean)).toEqual(
    action === `synchronize`
      ? [
          `api repos/${own}/actions/workflows/ci.yml/runs?status=completed&branch=feature&per_page=30 --jq`,
          ...queried.map(([id]) => `api repos/${own}/actions/runs/${id}/jobs?per_page=100 --jq`),
        ]
      : [],
  )
})

test.each([
  [`preview`, true],
  [`source`, true],
  [undefined, false],
] as const)(
  `browser mode %s preserves source-inspection coverage and renderer selection (CI=%s)`,
  async (mode, is_ci) => {
    vi.stubEnv(`MATTERVIZ_E2E_MODE`, mode)
    vi.stubEnv(`CI`, String(is_ci))
    onTestFinished(() => {
      vi.unstubAllEnvs()
    })
    vi.resetModules()
    const { default: config } = await import(`../../playwright.config`)
    expect(config.use.channel).toBe(`chromium`)
    if (is_ci)
      expect(config.workers, `software GPU tests must not overlap on a CI runner`).toBe(1)
    for (const job of [`e2e-source`, `e2e-test-shards`]) {
      const install_args = jobs[job].steps
        .find(({ run }) => run?.includes(`playwright install`))
        ?.run.split(/\s+/)
      // The selected channel needs full Chromium, which --only-shell omits.
      expect(install_args).toContain(`chromium`)
      expect(install_args).not.toContain(`--only-shell`)
      const test_command = jobs[job].steps.find(({ run }) =>
        run?.includes(`playwright test`),
      )?.run
      expect(test_command).toMatch(/^xvfb-run -a /)
      expect(test_command?.split(/\s+/)).toContain(`--headed`)
    }
    for (const argument of [
      `--use-webgpu-adapter=swiftshader`,
      `--use-vulkan=swiftshader`,
      `--use-angle=swiftshader`,
      `--disable-vulkan-surface`,
    ])
      expect(config.use.launchOptions.args.includes(argument), argument).toBe(is_ci)
    // These suites import /src/ modules directly or inspect live scene registries through helpers.
    const source_files = [`structure/host-tool`]
    for (const file of source_files) {
      const filename = `tests/playwright/${file}.test.ts`
      expect(config.grepInvert?.test(`${filename} example test`) ?? false).toBe(
        mode === `preview`,
      )
      expect(config.grep?.test(`${filename} example test`) ?? false).toBe(mode === `source`)
    }
    const module_request_test = `spectral/phonon-mode-explorer.test.ts fixture loading race @source`
    expect(config.grepInvert?.test(module_request_test) ?? false).toBe(mode === `preview`)
    expect(config.grep?.test(module_request_test) ?? false).toBe(mode === `source`)
    expect(
      config.grep?.test(`spectral/phonon-mode-explorer.test.ts renders controls`) ?? false,
    ).toBe(false)
    expect(config.grepInvert?.test(`tests/playwright/plot/bar-plot.test.ts`) ?? false).toBe(
      false,
    )
    expect(config.webServer.command).toContain(mode === `preview` ? `vp preview` : `vp dev`)
  },
)

const { jobs: release_jobs } = load(readFileSync(`.github/workflows/publish.yml`, `utf8`)) as {
  jobs: Record<string, { needs?: string | string[]; steps: { run?: string }[] }>
}

test(`release builds overlap CI while every publisher waits for CI and all artifacts`, () => {
  const packages = Object.keys(release_jobs).filter((name) => name.startsWith(`package_`))
  expect(packages).toHaveLength(4)
  for (const name of packages) expect(release_jobs[name].needs).toBe(`prepare`)
  const publishers = Object.keys(release_jobs).filter((name) => name.startsWith(`publish_`))
  expect(publishers).toHaveLength(3)
  for (const name of publishers) {
    expect(new Set(release_jobs[name].needs)).toEqual(new Set([`prepare`, `ci`, ...packages]))
  }
  expect(new Set(release_jobs.finalize.needs)).toEqual(new Set([`prepare`, ...publishers]))
})

test.each(
  [`publish_npm`, `publish_pypi`].flatMap((job) =>
    [true, false].map((dry_run) => [job, dry_run] as const),
  ),
)(`%s dry_run=%s keeps version-conflict overrides out of real releases`, (job, dry_run) => {
  const script = release_jobs[job].steps.find((step) => step.run)?.run
  if (!script) throw new Error(`Missing publish script: ${job}`)
  const scratch = mkdtempSync(join(tmpdir(), `matterviz-publish-`))
  onTestFinished(() => rmSync(scratch, { recursive: true, force: true }))
  mkdirSync(join(scratch, `release`))
  writeFileSync(join(scratch, `release/matterviz_jupyterlab-0.7.0-py3-none-any.whl`), `wheel`)
  // Stub network commands, then execute the actual workflow shell and inspect its arguments.
  const { status, stdout, stderr } = spawnSync(
    `bash`,
    [
      `-e`,
      `-c`,
      `npx() { printf '%s\\n' "$@"; }; npm() { :; }; uv() { printf '%s\\n' "$@"; };\n${script}`,
    ],
    {
      cwd: scratch,
      encoding: `utf8`,
      env: {
        ...process.env,
        DRY_RUN: String(dry_run),
        RELEASE_VERSION: `0.7.0`,
        PACKAGE_NAME: `matterviz`,
      },
    },
  )
  expect(status, stderr).toBe(0)
  const args = stdout.trim().split(`\n`)
  expect(args.includes(`--dry-run`)).toBe(dry_run)
  expect(args.includes(`--force`)).toBe(job === `publish_npm` && dry_run)
  expect(args.includes(`--check-url`)).toBe(job === `publish_pypi` && !dry_run)
  if (job === `publish_pypi`)
    expect(args).toEqual(expect.arrayContaining([`--trusted-publishing`, `always`]))
})
