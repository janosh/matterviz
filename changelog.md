### Changelog

All notable changes to this project will be documented in this file. Dates are displayed in UTC.

#### [v0.1.3](https://github.com/janosh/periodic-table/compare/v0.1.2...v0.1.3)

> 2023-01-08

- pnpm add -D svelte-zoo mdsvexamples [`154b121`](https://github.com/janosh/periodic-table/commit/154b121eafa27b2c9fd856647bb11136a8f9dd29)
- pnpm add -D d3-color to set ElementTile text_color based on lightness of bg_color [`cc6c399`](https://github.com/janosh/periodic-table/commit/cc6c3995e05e1796ac3398f649d3c9ba8775f688)
- add tests 'clicking element tile emits event', 'gap prop' and 'setting active_category=%s highlights corresponding element tiles' [`a19ac38`](https://github.com/janosh/periodic-table/commit/a19ac383d776512907ed49824d00b9951a0100ca)

<!-- auto-changelog-above -->

#### [v0.1.2](https://github.com/janosh/periodic-table/compare/v0.1.1...v0.1.2)

> 2023-01-04

- remove `EasterEgg.svelte` from landing page [`257d73a`](https://github.com/janosh/periodic-table/commit/257d73a2ede19e992274f4240b128a246bd3a684)
- `PeriodicTable` forward `click`, `mouseenter`, `mouseleave`, `keyup`, `keydown` events from `ElementTile` [`7450f71`](https://github.com/janosh/periodic-table/commit/7450f71fc3cb815412d7e4102c73179a196da834)
- add prop `gap = 0.3cqw` between element tiles, default is `0.3%` of container width [`c625fbc`](https://github.com/janosh/periodic-table/commit/c625fbc134c47519823efb644ef48093d08b56a4)

#### [v0.1.1](https://github.com/janosh/periodic-table/compare/v0.1.0...v0.1.1)

> 2023-01-03

- only wrap ElementTile in &lt;a&gt; if passed href prop, else &lt;div&gt; [`73a61be`](https://github.com/janosh/periodic-table/commit/73a61be112f4fe1554b9e4e78c2ff65fddb96e35)

#### 0.1.0

> 2023-01-03

- move d3-array, d3-interpolate-path, d3-shape, d3-scale, @iconify/svelte from package devDeps to deps [`0898f1e`](https://github.com/janosh/sveriodic-table/commit/0898f1e3c2012cc012d751ea48dde4429e7c1666)
- export active_element + active_category from PeriodicTable.svelte [`1ab602b`](https://github.com/janosh/sveriodic-table/commit/1ab602b26ceaf876a8683ba70d2a238dfc3652fc)
- move types into src/lib/index.ts [`5072c76`](https://github.com/janosh/sveriodic-table/commit/5072c76003b3942b1ebcb6f7aee473cf1381c3e7)
- add coverage badges to readme [`264e375`](https://github.com/janosh/sveriodic-table/commit/264e375614f0e4b84dc2d17c5d574c630478b1b2)
- revert #13 `src/lib/element-data.{yml -> ts}` [`b3d11f9`](https://github.com/janosh/sveriodic-table/commit/b3d11f9218dca5a3a6b48d5387f735065e222e45)
- add npm install cmd to readme [`278d17f`](https://github.com/janosh/sveriodic-table/commit/278d17f6323dc8051158c256446dc2872cade6ba)
- move non-package components to new src/site dir [`ddeef16`](https://github.com/janosh/sveriodic-table/commit/ddeef16a26ae44e4d3fa997f8fa6b76eaee284de)
- NPM Release [`#16`](https://github.com/janosh/sveriodic-table/pull/16)
- Deploy site to GitHub Pages [`#15`](https://github.com/janosh/sveriodic-table/pull/15)
- add test 'hooking PeriodicTable up to PropertySelect and selecting heatmap sets element tile background' [`#14`](https://github.com/janosh/sveriodic-table/pull/14)
- convert `src/lib/element-data.{ts -> yml}` [`#13`](https://github.com/janosh/sveriodic-table/pull/13)
- Migrate to PNPM [`#12`](https://github.com/janosh/sveriodic-table/pull/12)
- Update scatter tooltip when hovering element tiles [`#9`](https://github.com/janosh/sveriodic-table/pull/9)
- SvelteKit auto migration [`#8`](https://github.com/janosh/sveriodic-table/pull/8)
- pre-commit autoupdate [`#5`](https://github.com/janosh/sveriodic-table/pull/5)
- Add fill area below elemental periodicity line plot [`#4`](https://github.com/janosh/sveriodic-table/pull/4)
- add individual element detail pages (closes #1) [`#1`](https://github.com/janosh/sveriodic-table/issues/1)
- split ActiveElement.svelte into TableInset + ElementStats + ElementPhoto (closes #2, closes #3) [`#2`](https://github.com/janosh/sveriodic-table/issues/2) [`#3`](https://github.com/janosh/sveriodic-table/issues/3)
- initial commit [`feeae8f`](https://github.com/janosh/sveriodic-table/commit/feeae8f84678316b408a1bf4f3bfc269901a73b9)
- spice up ElementStats and element detail pages with iconify icons [`4eace91`](https://github.com/janosh/sveriodic-table/commit/4eace919af8b49ec44b261892a3df5cc6cf3db2b)
- add ability to plot predefined heat maps [`71459fa`](https://github.com/janosh/sveriodic-table/commit/71459fab6283acda6d11a552896d252aa4683fb0)
- add show icons toggle to Footer [`7649f90`](https://github.com/janosh/sveriodic-table/commit/7649f9074e41b2906224ddeb14015f59961d535a)
- fix scatter point fill color, `mv {ChemicalElement->ElementTile}.svelte`, now controlled externally by PeriodicTable.svelte [`9d10109`](https://github.com/janosh/sveriodic-table/commit/9d10109ffec04d2b4c5a58fb37c9920fda6712aa)
- add PrevNextElement.svelte to element detail pages [`266fab3`](https://github.com/janosh/sveriodic-table/commit/266fab336c5e4f9abc46d611647435ae6181c03f)
- fix ColorCustomizer which had zero effect since adding heatmap functionality [`80dcfb0`](https://github.com/janosh/sveriodic-table/commit/80dcfb0d52d9acbdbaf69ea6b23b5fd57d8891c5)
- show table of electron occupations per orbital in element detail page [`c3580c0`](https://github.com/janosh/sveriodic-table/commit/c3580c00030bad268b7701e500278ab0dfb0dc45)
- add __layout +__error pages [`ffe433e`](https://github.com/janosh/sveriodic-table/commit/ffe433ec30acc29acffe194afbf9e3d86ec1ddd1)
- show PeriodicTable on element detail pages [`b7d1313`](https://github.com/janosh/sveriodic-table/commit/b7d1313a3233e4fe2989906a583e8a5c1a808b8b)
- improve detail page layout [`b6cf71a`](https://github.com/janosh/sveriodic-table/commit/b6cf71af4c0418955253ca23ca1bd89db49942c3)
- improve test coverage for periodic table in heatmap mode and Bohr atoms page [`343662b`](https://github.com/janosh/sveriodic-table/commit/343662b7a8dfd40b7dfc59f34c2a623e2d7367ee)
- keep scroll pos on element tile links [`2dbc382`](https://github.com/janosh/sveriodic-table/commit/2dbc38207ad4b1acbdb6b7dbc54df045e160179b)
- add basic E2E tests and run in CI on push & pull to main branch [`e031919`](https://github.com/janosh/sveriodic-table/commit/e03191935775c4853091220624773942835edfc3)
- add ScatterPlot into TableInset showing periodicity trends when heat map selected [`efd2ed6`](https://github.com/janosh/sveriodic-table/commit/efd2ed6f1705c2ae92d7dbcf18ad0b9a560a52c9)
- add EasterEgg.svelte [`c8959ba`](https://github.com/janosh/sveriodic-table/commit/c8959badde4b777f83f01dbf941c5a3086a1c5b7)
- delete 'boil' key in periodic-table-data.ts [`e8eb1cf`](https://github.com/janosh/sveriodic-table/commit/e8eb1cf846beced5c86990afffcefa7c2047dc7a)
- move ColorCustomizer from PeriodicTable to index.svelte and hide it when in heatmap mode [`688a0bd`](https://github.com/janosh/sveriodic-table/commit/688a0bd3650d89f8f92b76488c1bbc80da64881d)
- improve element tile and element stats inset screen width responsiveness [`7b2b762`](https://github.com/janosh/sveriodic-table/commit/7b2b7628d132a27bf3fcd8a581c7156b6695f016)
- add vitest unit tests [`fad1b3a`](https://github.com/janosh/sveriodic-table/commit/fad1b3a90176bdb5ffd45168adc81f943fd2dbb8)
- fix pretty_num() raising TypeError: Cannot read properties of null (reading 'toExponential') [`fa81d29`](https://github.com/janosh/sveriodic-table/commit/fa81d2977296d1a9159b5873e1079cb8f5138b77)
- move heatmap + color_scale to svelte stores [`0bb686b`](https://github.com/janosh/sveriodic-table/commit/0bb686b05399d63829ec27d57ff7b95b1f7ef790)
- fix Bohr electron orbital speed [`ff3af1a`](https://github.com/janosh/sveriodic-table/commit/ff3af1af12ef9d6c67fb673cd048028ea424317e)
- fix ScatterPlot label and grid offset [`942719b`](https://github.com/janosh/sveriodic-table/commit/942719b2e7f3f896406e909f93cc57a4eca9cc3a)
- declare module periodic-table-data.ts + clean up [`6b9f717`](https://github.com/janosh/sveriodic-table/commit/6b9f7178246a9aee0c02c6abe634811eb95f6650)
- add hover tooltip for scatter plot [`0745307`](https://github.com/janosh/sveriodic-table/commit/07453070fdd77862279adeede2fead33fd3372bf)
- add src/lib/BohrAtom.svelte [`ccb8e02`](https://github.com/janosh/sveriodic-table/commit/ccb8e020704884c30c813cb1ef05ba1ec81cf589)
- fix scatter plot not showing on element detail pages without photo [`9501bbb`](https://github.com/janosh/sveriodic-table/commit/9501bbbfe2f24541e4a8db3ab7192702653744d7)
- add BohrAtom to [slug].svelte [`6b3a71d`](https://github.com/janosh/sveriodic-table/commit/6b3a71d1ad675252f1df926618a4186d0d9b0fc2)
- add src/lib/Toggle.svelte [`a80df20`](https://github.com/janosh/sveriodic-table/commit/a80df20d7007fb66f5fe1b4e04e2cd2e9ee4264c)
- add x and y axes to ScatterPlot.svelte [`f6f8325`](https://github.com/janosh/sveriodic-table/commit/f6f8325d1d9f76861df0c53ea832a3833762284c)
- add prop highlight_shell to BohrAtom.svelte [`5741f34`](https://github.com/janosh/sveriodic-table/commit/5741f348c12339e613a91aa035d5ca961d75f141)
- improve SEO meta tags on index and `[slug]` pages [`abb5152`](https://github.com/janosh/sveriodic-table/commit/abb515269ef6e0da5b2e8d7962b14da711242551)
- add src/lib/PropertySelect.svelte used by `index.svelte` and `[slug].svelte` [`2654347`](https://github.com/janosh/sveriodic-table/commit/2654347ebfe27ba9bac11e04dc8e3ad7c6371d53)
- incl logo in readme heading, update deps, fix error page offline warning [`415e788`](https://github.com/janosh/sveriodic-table/commit/415e788d62d2e770d961cedb6f8e2f82ae9c72e9)
- simplify svg coords in BohrAtom.svelte by placing origin in `<svg>` center [`3511ca4`](https://github.com/janosh/sveriodic-table/commit/3511ca445975f2f9654a4d02eba9c05cf1ca94f7)
- add src/routes/bohr-atoms.svelte [`b77abe8`](https://github.com/janosh/sveriodic-table/commit/b77abe868e9c4fe62831c19380ffb5158b1a0f92)
- add element detail page screen recording to readme [`88a27be`](https://github.com/janosh/sveriodic-table/commit/88a27bebb8deda53ed75724622b1c3ab231a1c2b)
- add toggle to start/stop electrons orbiting nucleus [`fcd9022`](https://github.com/janosh/sveriodic-table/commit/fcd9022ceea8e8ed18a2a5633fd6a8fac41e2b87)
- fix density unit to g/liter for gases instead of g/cm^3 for solids/liquids [`a145443`](https://github.com/janosh/sveriodic-table/commit/a145443a69c3ab1e4c42902f440308f506df3ce3)
- hide element names if `windowWidth < 1000` to prevent text overflow [`905d932`](https://github.com/janosh/sveriodic-table/commit/905d93221059708eb9e77b8cbbd4d8342c497140)
- drop year heatmap, add covalent_radius + first_ionization instead [`6b2953e`](https://github.com/janosh/sveriodic-table/commit/6b2953e049a340c830ef0a8e2b7a70595824f88c)
- keep increased brightness on last-active element [`b441c78`](https://github.com/janosh/sveriodic-table/commit/b441c78fef0f2015038b06716619a48af9fccda3)
- update index page screenshot [`853cd18`](https://github.com/janosh/sveriodic-table/commit/853cd181bc16fa61dc67062f265ed272cc3c2e86)
- tweak ColorCustomizer.svelte CSS [`cdcf92e`](https://github.com/janosh/sveriodic-table/commit/cdcf92e405a50417a416d18b534292a4bdd8dfa7)
- add ScatterPlot axis labels [`65fdc41`](https://github.com/janosh/sveriodic-table/commit/65fdc41b36ee1aa0666a180f925fcd592451101f)
- change import to import type for purely type imports [`ac53e0e`](https://github.com/janosh/sveriodic-table/commit/ac53e0e1d172e69e506cb9de0a593ac9021b5d3f)
- display BohrAtom in PeriodicTable if window width permits [`c5aacdc`](https://github.com/janosh/sveriodic-table/commit/c5aacdc100e3aaf8e69eced79046ca5f400eefc0)
- make ScatterPlot always show current element on detail pages unless user actively hovers another element [`6a4c021`](https://github.com/janosh/sveriodic-table/commit/6a4c021e6c53a6a815d22a97b679680e3d17c8c1)
- document BohrAtom.svelte props [`bc100c2`](https://github.com/janosh/sveriodic-table/commit/bc100c221961f312641c1ba4f959b6aff3bff96c)
- reinstate default category color css variables [`7dae519`](https://github.com/janosh/sveriodic-table/commit/7dae519f6e4b155945699a40482564f755372840)
- acknowledge images-of-elements.com and github.com/kadinzhang/Periodicity in readme [`92d9941`](https://github.com/janosh/sveriodic-table/commit/92d9941b1d274bf9a827399532a32aa2d40071df)
- link to /bohr-atoms page from footer [`eca7889`](https://github.com/janosh/sveriodic-table/commit/eca7889d304203b39de0207bdcbf9a70efa5839a)
- silence sveltekit tsconfig warning [`c3a4a0c`](https://github.com/janosh/sveriodic-table/commit/c3a4a0c5e8072c896dfa0f576a8ee3ed400a55b5)
- mv src/lib/graph/* src/lib [`2d7eb2f`](https://github.com/janosh/sveriodic-table/commit/2d7eb2f64e13034b3dfca3e504259be37871028d)
- add screenshot to readme [`54084ed`](https://github.com/janosh/sveriodic-table/commit/54084ed70ddb1de81a1800dbd02f30af4a30ea2f)
