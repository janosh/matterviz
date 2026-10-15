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

const e2e_actions = [`opened`, `reopened`, `synchronize`, `published`, undefined] as const

test.each([
  [`unit-tests`, [`unit-test-shards`, `publint`]],
  [`e2e-tests`, [`e2e-test-shards`, `e2e-source`]],
])(`%s requires every test job to succeed`, (gate_name, dependencies) => {
  const gate = jobs[gate_name]
  expect(gate.if).toBe(`always()`)
  expect(gate.needs).toEqual(dependencies)
  const [step] = gate.steps
  const gate_status = (results: Record<string, string>, action?: string) => {
    const needs = Object.fromEntries(
      dependencies.map((name) => [name, { result: results[name] ?? `success` }]),
    )
    const github = { event: { action } }
    const result = eval_expr(step.env.RESULT.slice(3, -2), { needs, github })
    return spawnSync(`bash`, [`-e`, `-c`, step.run], {
      env: { ...process.env, RESULT: String(result) },
    }).status
  }
  for (const action of e2e_actions) {
    for (const dependency of dependencies) {
      for (const result of [`success`, `failure`, `cancelled`, `skipped`, ``]) {
        const status = gate_status({ [dependency]: result }, action)
        expect(status, `${action} ${dependency}: ${result}`).toBe(result === `success` ? 0 : 1)
      }
    }
    // E2E is skipped on purpose only for synchronize pushes; anywhere else skipping means a
    // failed upstream job (e.g. build-site) and must fail the required check.
    const all_skipped = Object.fromEntries(dependencies.map((name) => [name, `skipped`]))
    const skip_ok = gate_name === `e2e-tests` && action === `synchronize`
    expect(gate_status(all_skipped, action), `${action}: all skipped`).toBe(skip_ok ? 0 : 1)
  }
})

test.each(e2e_actions)(`full E2E suite runs on %s events but not synchronize`, (action) => {
  const github = { event: { action } }
  for (const job of [`build-site`, `e2e-source`])
    expect(eval_expr(jobs[job].if, { github }), job).toBe(action !== `synchronize`)
  // Production shards inherit the skip from build-site.
  expect(jobs[`e2e-test-shards`].if).toBeUndefined()
  expect(jobs[`e2e-test-shards`].needs).toBe(`build-site`)
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
