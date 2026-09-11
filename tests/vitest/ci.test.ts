import { load } from 'js-yaml'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { expect, onTestFinished, test, vi } from 'vitest'

type Gate = {
  if: string
  needs: string[]
  steps: { run: string; env: { RESULT: string } }[]
}
const { jobs, concurrency } = load(readFileSync(`.github/workflows/ci.yml`, `utf8`)) as {
  jobs: Record<string, Gate>
  concurrency: { group: string; 'cancel-in-progress': string }
}

test.each([
  [`CI`, 465, `CI-465`, true],
  [`CI`, undefined, `CI-refs/heads/feature`, true],
  [`Publish`, undefined, `Publish-123`, false],
])(`%s cancellation with PR %s respects the caller`, (workflow, pr_number, group, cancel) => {
  // These expressions use only property access, equality and &&/||, shared by JS and Actions.
  // workflow_dispatch is also the event inside a manually dispatched reusable release gate.
  const github = {
    workflow,
    event_name: `workflow_dispatch`,
    event: { pull_request: { number: pr_number } },
    ref: `refs/heads/feature`,
    run_id: 123,
  }
  const evaluate = (template: string) =>
    template.replaceAll(/\$\{\{(?<expression>.+?)\}\}/g, (_match, expression: string) =>
      String(runInNewContext(expression, { github })),
    )
  expect(evaluate(concurrency.group)).toBe(group)
  expect(evaluate(concurrency[`cancel-in-progress`])).toBe(String(cancel))
  github.run_id = 456
  expect(evaluate(concurrency.group)).toBe(workflow === `CI` ? group : `Publish-456`)
})

test.each([
  [`unit-tests`, [`unit-test-shards`, `publint`]],
  [`e2e-tests`, [`e2e-test-shards`, `e2e-source`]],
])(`%s requires every test job to succeed`, (gate_name, dependencies) => {
  const gate = jobs[gate_name]
  expect(gate.if).toBe(`always()`)
  expect(gate.needs).toEqual(dependencies)
  const [step] = gate.steps
  for (const dependency of dependencies) {
    for (const result of [`success`, `failure`, `cancelled`, `skipped`, ``]) {
      const needs = Object.fromEntries(
        dependencies.map((name) => [
          name,
          {
            result: name === dependency ? result : `success`,
          },
        ]),
      )
      const expression = step.env.RESULT.slice(3, -2).replaceAll(
        /needs\.(?<job>[\w-]+)/g,
        (_, name: string) => `needs["${name}"]`,
      )
      const { status } = spawnSync(`bash`, [`-e`, `-c`, step.run], {
        env: { ...process.env, RESULT: String(runInNewContext(expression, { needs })) },
      })
      expect(status, `${dependency}: ${result}`).toBe(result === `success` ? 0 : 1)
    }
  }
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
    for (const argument of [
      `--use-webgpu-adapter=swiftshader`,
      `--use-vulkan=swiftshader`,
      `--use-angle=vulkan`,
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
    expect(config.webServer.command).toContain(
      mode === `preview` ? `vite preview` : `vite dev`,
    )
  },
)

test(`release builds overlap CI while every publisher waits for CI and all artifacts`, () => {
  const { jobs: release_jobs } = load(
    readFileSync(`.github/workflows/publish.yml`, `utf8`),
  ) as { jobs: Record<string, { needs?: string | string[] }> }
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

test.each([
  [`publish_npm`, true],
  [`publish_npm`, false],
  [`publish_pypi`, true],
  [`publish_pypi`, false],
])(`%s dry_run=%s keeps version-conflict overrides out of real releases`, (job, dry_run) => {
  const { jobs: release_jobs } = load(
    readFileSync(`.github/workflows/publish.yml`, `utf8`),
  ) as { jobs: Record<string, { steps: { run?: string }[] }> }
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
