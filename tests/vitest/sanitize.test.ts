import { sanitize_formula, sanitize_html, sanitize_icon_svg, sanitize_svg } from '$lib'
import { describe, expect, test } from 'vitest'

// XSS payloads that must never survive any sanitizer
const XSS_PAYLOADS = [
  `<script>alert('xss')</script>`,
  `<img src=x onerror=alert(1)>`,
  `<svg onload=alert(1)>`,
  `<iframe src="javascript:alert(1)"></iframe>`,
  `<b onclick=alert(1)>bold</b>`,
  `<a href="javascript:alert(1)">click</a>`,
  `<a href="data:text/html,<script>alert(1)</script>">click</a>`,
  `<div><script>alert(1)</script></div>`,
  `<object data="data:text/html,<script>alert(1)</script>"></object>`,
  `<embed src="javascript:alert(1)">`,
  `<form action="javascript:alert(1)"><input type=submit></form>`,
  `<meta http-equiv="refresh" content="0;url=javascript:alert(1)">`,
  `<base href="javascript:alert(1)">`,
  `<details open ontoggle=alert(1)>`,
  `<body onload=alert(1)>`,
  `<input onfocus=alert(1) autofocus>`,
  `<marquee onstart=alert(1)>`,
  `<template><script>alert(1)</script></template>`,
  `<math><mi href="javascript:alert(1)">x</mi></math>`,
  `<svg><foreignObject><body onload=alert(1)></body></foreignObject></svg>`,
]

function assert_no_xss(result: string): void {
  expect(result).not.toContain(`<script`)
  expect(result).not.toMatch(/on\w+\s*=/)
  expect(result).not.toContain(`javascript:`)
  expect(result).not.toMatch(/\bdata:[^,]*,/)
  expect(result).not.toContain(`<iframe`)
  expect(result).not.toContain(`<object`)
  expect(result).not.toContain(`<embed`)
  expect(result).not.toContain(`<meta`)
  expect(result).not.toContain(`<base`)
  expect(result).not.toContain(`<template`)
  expect(result).not.toContain(`<form`)
}

describe(`sanitize_html`, () => {
  test.each(XSS_PAYLOADS)(`strips XSS from: %s`, (payload) => {
    assert_no_xss(sanitize_html(payload))
  })

  test.each([
    [`bold`, `<b>bold</b>`],
    [`italic`, `<i>italic</i>`],
    [`emphasis`, `<em>emphasis</em>`],
    [`strong`, `<strong>strong</strong>`],
    [`subscript`, `<sub>2</sub>`],
    [`superscript`, `<sup>3+</sup>`],
    [`code`, `<code>x = 1</code>`],
    [`span with class`, `<span class="formula">H<sub>2</sub>O</span>`],
    [`span with title`, `<span title="tooltip">text</span>`],
    [`line break`, `text<br>more`],
    [`small`, `<small>footnote</small>`],
    [`Li₂O formula`, `Li<sub>2</sub>O`],
    [`Fe₂O₃ formula`, `Fe<sub>2</sub>O<sub>3</sub>`],
    [`Ca²⁺ ion`, `Ca<sup>2+</sup>`],
  ])(`preserves safe %s`, (_name, input) => {
    expect(sanitize_html(input)).toBe(input)
  })

  test(`preserves safe link with rel=noopener`, () => {
    const result = sanitize_html(`<a href="/materials/mp-123" target="_blank">mp-123</a>`)
    expect(result).toContain(`href="/materials/mp-123"`)
    expect(result).toContain(`target="_blank"`)
    expect(result).toContain(`rel="noopener"`)
    expect(result).toContain(`mp-123</a>`)
  })

  test(`merges noopener into existing rel without overwriting`, () => {
    const result = sanitize_html(`<a href="/x" rel="noreferrer">x</a>`)
    const rel_tokens = /rel="([^"]+)"/.exec(result)?.[1]?.split(/\s+/) ?? []
    expect(rel_tokens).toContain(`noreferrer`)
    expect(rel_tokens).toContain(`noopener`)
  })

  test.each([
    [`safe color`, `<span style="color: red">x</span>`, `<span style="color: red">x</span>`],
    [
      `safe multi`,
      `<span style="font-weight: bold; color: blue">x</span>`,
      `<span style="font-weight: bold; color: blue">x</span>`,
    ],
    [`dangerous bg`, `<span style="background: url(evil)">x</span>`, `<span>x</span>`],
    [`dangerous position`, `<span style="position: fixed; top: 0">x</span>`, `<span>x</span>`],
  ])(`style filtering: %s`, (_name, input, expected) => {
    expect(sanitize_html(input)).toBe(expected)
  })

  test(`handles mixed safe and unsafe content`, () => {
    expect(sanitize_html(`<b>bold</b><script>alert(1)</script><sub>2</sub>`)).toBe(
      `<b>bold</b><sub>2</sub>`,
    )
  })

  test(`strips data: URIs from links`, () => {
    const result = sanitize_html(`<a href="data:text/html,<script>alert(1)</script>">x</a>`)
    expect(result).not.toContain(`data:`)
  })

  test.each([
    [`empty`, ``, ``],
    [`whitespace`, `   `, `   `],
    [`null`, null, ``],
    [`undefined`, undefined, ``],
    [`zero`, 0, `0`],
    [`float`, 42.5, `42.5`],
    [`boolean`, true, `true`],
    [`NaN`, NaN, `NaN`],
  ] as const)(`handles %s input → "%s"`, (_name, input, expected) => {
    expect(sanitize_html(input)).toBe(expected)
  })

  test.each([
    [`malicious toString()`, { toString: (): string => `<script>alert(1)</script>` }],
    [`double-encoded entities`, `<img src=x onerror=&#97;&#108;&#101;&#114;&#116;(1)>`],
    [`null byte injection`, `<scr\x00ipt>alert(1)</script>`],
  ] as const)(`bypass attempt: %s`, (_name, input) => {
    assert_no_xss(sanitize_html(input))
  })

  test(`deeply nested dangerous content is stripped`, () => {
    const result = sanitize_html(
      `<b><i><span><em><strong><script>alert(1)</script></strong></em></span></i></b>`,
    )
    expect(result).not.toContain(`<script`)
    expect(result).toContain(`<b>`)
    expect(result).toContain(`<i>`)
  })
})

describe(`sanitize_formula`, () => {
  test.each([
    [`Fe2O3`, `Fe<sub>2</sub>O<sub>3</sub>`],
    [`Li2O`, `Li<sub>2</sub>O`],
    [`CaTiO3`, `CaTiO<sub>3</sub>`],
    [`Fe`, `Fe`],
  ])(`formats %s`, (formula, expected) => {
    expect(sanitize_formula(formula)).toBe(expected)
  })

  test(`returns raw formula when use_subscripts=false`, () => {
    expect(sanitize_formula(`Fe2O3`, false)).toBe(`Fe2O3`)
  })

  test(`handles empty formula`, () => {
    expect(sanitize_formula(``)).toBe(``)
  })

  test(`strips XSS injected via formula string`, () => {
    assert_no_xss(sanitize_formula(`<script>alert(1)</script>`))
    assert_no_xss(sanitize_formula(`Fe<img src=x onerror=alert(1)>2O3`))
  })
})

describe(`sanitize_svg`, () => {
  test.each(XSS_PAYLOADS)(`strips XSS from: %s`, (payload) => {
    assert_no_xss(sanitize_svg(payload))
  })

  test.each([
    [`dx/dy`, `<tspan dx="2" dy="5">text</tspan>`],
    [`fill/font-weight`, `<tspan fill="red" font-weight="bold">Fe</tspan>`],
  ])(`preserves tspan with %s`, (_name, input) => {
    expect(sanitize_svg(input)).toBe(input)
  })

  test.each([
    `<circle cx="10" r="5" />`,
    `<rect width="10" height="10" />`,
    `<path d="M0 0" />`,
  ])(`strips non-text SVG tag: %s`, (input) => {
    expect(sanitize_svg(input)).toBe(``)
  })

  test(`strips unsafe attributes from tspan`, () => {
    expect(sanitize_svg(`<tspan onclick="alert(1)">x</tspan>`)).toBe(`<tspan>x</tspan>`)
  })

  test(`returns empty string when all content is stripped`, () => {
    expect(sanitize_svg(`<script>alert(1)</script>`)).toBe(``)
    expect(sanitize_svg(``)).toBe(``)
  })
})

describe(`sanitize_icon_svg`, () => {
  test.each(XSS_PAYLOADS)(`strips XSS from: %s`, (payload) => {
    assert_no_xss(sanitize_icon_svg(payload))
  })

  test.each([
    [`path`, `<path d="M0 0 L10 10"></path>`],
    [`circle`, `<circle cx="12" cy="12" r="10"></circle>`],
    [`rect`, `<rect x="0" y="0" width="24" height="24"></rect>`],
    [`polyline`, `<polyline points="0,0 10,10 20,0"></polyline>`],
    [`polygon`, `<polygon points="0,0 10,10 20,0"></polygon>`],
    [`group + transform`, `<g transform="translate(2,2)"><path d="M0 0"></path></g>`],
    [
      `stroke attrs`,
      `<path d="M0 0" stroke="red" stroke-width="2" stroke-linecap="round"></path>`,
    ],
  ])(`preserves %s`, (_name, input) => {
    expect(sanitize_icon_svg(input)).toBe(input)
  })

  test(`strips event handlers from SVG elements`, () => {
    expect(sanitize_icon_svg(`<path d="M0 0" onclick="alert(1)"></path>`)).toBe(
      `<path d="M0 0"></path>`,
    )
  })

  test(`strips non-SVG elements like script and iframe`, () => {
    const result = sanitize_icon_svg(`<path d="M0 0"></path><script>alert(1)</script>`)
    expect(result).not.toContain(`<script`)
    expect(result).toContain(`<path d="M0 0"></path>`)
  })

  test(`strips href attributes to prevent SVG-based XSS`, () => {
    const result = sanitize_icon_svg(`<use href="javascript:alert(1)"></use>`)
    expect(result).not.toContain(`href`)
    expect(result).not.toContain(`javascript:`)
  })

  test(`strips xlink:href attributes (legacy namespace)`, () => {
    const result = sanitize_icon_svg(`<use xlink:href="javascript:alert(1)"></use>`)
    expect(result).not.toContain(`xlink:href`)
    expect(result).not.toContain(`javascript:`)
  })
})
