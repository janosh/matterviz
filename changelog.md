### Changelog

All notable changes to this project will be documented in this file. Dates are displayed in UTC.

#### [v0.3.12](https://github.com/janosh/elementari/compare/v0.3.11...v0.3.12)

> 3 May 2025

- fix missing colors, math, plot, periodic-table exports in package.json + add range_padding prop to ScatterPlot [`73e1af4`](https://github.com/janosh/elementari/commit/73e1af45deeb3de261202e3e64e7dc865747dbf6)
- `ColorScaleSelect.svelte` add prop `options: D3InterpolateName[]` [`2783ed2`](https://github.com/janosh/elementari/commit/2783ed2f0482fcacf7beb22d1174a24d96fe83f4)
- breaking: rename `cbar_props` to `colorbar` in `ColorScaleSelect` + `n_items` with `layout_tracks` in `PlotLegend` [`4f5c927`](https://github.com/janosh/elementari/commit/4f5c927966bf8214134b7fa110e8372efb91a5ab)

#### [v0.3.11](https://github.com/janosh/elementari/compare/v0.3.10...v0.3.11)

> 30 April 2025

- ScatterPlot add dynamic size scaling of points based on observed value range in series [`62cc6fc`](https://github.com/janosh/elementari/commit/62cc6fc1a95675d91b2b29200bb8ee3d70752c1f)
- breaking: ScatterPlot and ScatterPoint use single offset object for labels, replacing offset_x and offset_y [`072c3ac`](https://github.com/janosh/elementari/commit/072c3ac3e44c468ae4cde95e3d79bf2d2b7fc782)

#### [v0.3.10](https://github.com/janosh/elementari/compare/v0.3.9...v0.3.10)

> 28 April 2025

- Fix ScatterPlot zoom [`#63`](https://github.com/janosh/elementari/pull/63)

#### [v0.3.9](https://github.com/janosh/elementari/compare/v0.3.8...v0.3.9)

> 27 April 2025

- `ScatterPlot` allow custom tween easing and interpolation functions + fix NaNs in interpolated ScatterPoint coords when tweening between linear/log scaled [`#62`](https://github.com/janosh/elementari/pull/62)

#### [v0.3.8](https://github.com/janosh/elementari/compare/v0.3.7...v0.3.8)

> 25 April 2025

- `PlotLegend.svelte` [`#61`](https://github.com/janosh/elementari/pull/61)

#### [v0.3.7](https://github.com/janosh/elementari/compare/v0.3.6...v0.3.7)

> 20 April 2025

- smarter `ColorBar.svelte` with better auto number of ticks and tick_side logic (primary/secondary/inside) [`e13bf4a`](https://github.com/janosh/elementari/commit/e13bf4aae902bfb106373f072cac06a2216fe1a6)

#### [v0.3.6](https://github.com/janosh/elementari/compare/v0.3.5...v0.3.6)

> 19 April 2025

- Auto-placed ScatterPlot labels [`#60`](https://github.com/janosh/elementari/pull/60)

#### [v0.3.5](https://github.com/janosh/elementari/compare/v0.3.4...v0.3.5)

> 19 April 2025

- Make `ScatterPlot.svelte` drag-zoomable and add auto-placed `ColorBar` [`#59`](https://github.com/janosh/elementari/pull/59)

#### [v0.3.4](https://github.com/janosh/elementari/compare/v0.3.3...v0.3.4)

> 17 April 2025

- Add `color_scale_type`, `color_scheme`, `color_range` props to `ScatterPlot` for coloring points by numeric values [`#58`](https://github.com/janosh/elementari/pull/58)

#### [v0.3.3](https://github.com/janosh/elementari/compare/v0.3.2...v0.3.3)

> 5 April 2025

- `ScatterPlot` now supports per-point properties for style, marker type, size and color [`f83c003`](https://github.com/janosh/elementari/commit/f83c0038ec0c09ff702887517012bed6dc4a490b)
- add x/y axes log-scale support to `ScatterPlot` [`70f8dc4`](https://github.com/janosh/elementari/commit/70f8dc4315e38ad63a76845f6b29a484925434f7)

#### [v0.3.2](https://github.com/janosh/elementari/compare/v0.3.0...v0.3.2)

> 3 April 2025

- `ScatterPlot` support custom x/y tick label spacing and formatting [`#56`](https://github.com/janosh/elementari/pull/56)

#### [v0.3.0](https://github.com/janosh/elementari/compare/v0.2.7...v0.3.0)

> 25 March 2025

- Migrate to Svelte 5 runes syntax [`#55`](https://github.com/janosh/elementari/pull/55)
- enable external component styling with new CSS custom vars [`29d084a`](https://github.com/janosh/elementari/commit/29d084a30ceed48d684f1f148c617358b39f4de3)

#### [v0.2.7](https://github.com/janosh/elementari/compare/v0.2.6...v0.2.7)

> 17 February 2025

- allow multiple lines/sets of points in ScatterPlot [`c0e37d6`](https://github.com/janosh/elementari/commit/c0e37d6467488dc37ea15b7a4690f62dc8ab5698)
- update all deps to latest and migrate unit tests to svelte v5 [`4a8b352`](https://github.com/janosh/elementari/commit/4a8b352274a1e071faf8f4320364ee7788e4f447)

#### [v0.2.6](https://github.com/janosh/elementari/compare/v0.2.4...v0.2.6)

> 5 February 2025

#### [v0.2.4](https://github.com/janosh/elementari/compare/v0.2.3...v0.2.4)

> 5 February 2025

- Couple new unit tests [`#52`](https://github.com/janosh/elementari/pull/52)
- Add `parse_si_float` inverse function to `pretty_num` in `labels.ts` [`#50`](https://github.com/janosh/elementari/pull/50)
- Fix and speedup `max_dist` and `nearest_neighbor` bonding algorithms [`#48`](https://github.com/janosh/elementari/pull/48)
- Support partial site occupancies by rendering atoms as multiple sphere slices [`#46`](https://github.com/janosh/elementari/pull/46)
- add ScatterPlot date formatting [`01f8180`](https://github.com/janosh/elementari/commit/01f81806b0ab791190bddcfd12e680d966d2f528)
- define type AtomsGraph and subtypes for (Structure|Molecule)Graph [`85a044c`](https://github.com/janosh/elementari/commit/85a044cdec93c4eedf3f39d340de41ff90053862)

#### [v0.2.3](https://github.com/janosh/elementari/compare/v0.2.0...v0.2.3)

> 15 January 2024

- Add props and control sliders for ambient and directional lighting to `Structure` [`#45`](https://github.com/janosh/elementari/pull/45)
- Add `SymmetryCard.svelte` [`#42`](https://github.com/janosh/elementari/pull/42)
- add /molecule demo page with initial examples water, methane, benzene [`71ce70b`](https://github.com/janosh/elementari/commit/71ce70b338d0cb80c2b7468fc98f2f5c7f480c61)
- fix find_image_atoms() for non-cuboid lattices [`9138582`](https://github.com/janosh/elementari/commit/91385820a69f5873815e4a321b37a7a9af33be18)
- add lib/structure/bonding.ts with max_dist and nearest_neighbor bonding strategies [`f707cf2`](https://github.com/janosh/elementari/commit/f707cf28340541ad4f9c52ae4ba216f7b0eacf61)
- add lib/math.ts [`58cf060`](https://github.com/janosh/elementari/commit/58cf060e5158793d53d52776d444b7357ccc4c71)
- Structure add fullscreen button + improve default initial camera_position [`bda2e5f`](https://github.com/janosh/elementari/commit/bda2e5fb7d0fdd12cdb902fdf7a89d61ef4d958d)
- fix black text color on transparent ElementTiles [`3ace071`](https://github.com/janosh/elementari/commit/3ace071110cf100a65116d60d8dd511d340fe5a0)
- add src/emmet_pydantic_to_ts.py to auto-convert emmet pydantic models to typescript types [`e4bcc92`](https://github.com/janosh/elementari/commit/e4bcc92ab78565693b19e444c51f53a968b13744)
- add /api page to inspect AWS Open Data schema [`83bc866`](https://github.com/janosh/elementari/commit/83bc866fcb4f241401f126328313343d8fa1819b)
- add similar structures and robocrys sections to mp-[slug] page [`d4dce4b`](https://github.com/janosh/elementari/commit/d4dce4b9704318428a9962f5b7e8315ea7f6851e)
- extract (demos)/periodic-table/+page.svelte from landing page, change landing +page.svelte to +page.md [`cd32144`](https://github.com/janosh/elementari/commit/cd32144874e1eb2398dc30fc1977bf7eeaaf7cfb)
- fix duplicate bonds in max_dist and nearest_neighbor functions [`14027e3`](https://github.com/janosh/elementari/commit/14027e36af155b40f332f5768c7162ec919b0809)
- StructureScene add prop fov: number | undefined = undefined [`770ffbf`](https://github.com/janosh/elementari/commit/770ffbf36e8e1aa9d68bfe2cb4f7656d11ec7fbf)
- rename prop site_labels -> show_site_labels, default to true + fix site site_labels rendering [`ff0336a`](https://github.com/janosh/elementari/commit/ff0336a8a8236e166b5f64dddfc7cdc59331d1f0)
- add largest MP structure mp-1204603 to demo [`1b0bc6d`](https://github.com/janosh/elementari/commit/1b0bc6d96c0d450f696665d2f3733048d9bda2b5)
- bump threlte to v6 official release [`45e3dc2`](https://github.com/janosh/elementari/commit/45e3dc2c0a28ffd3d076c3ada986c2c639215757)
- periodic-table.test.ts don't iterate over full table, do random subset for speed [`be68b6a`](https://github.com/janosh/elementari/commit/be68b6ab27b8d3ab527042859f62f8056bdd94e4)
- fetch_zipped() only console.error, not raise if !response.ok [`f46cee0`](https://github.com/janosh/elementari/commit/f46cee00e1383c7509334638e4141d7a71955d59)

#### [v0.2.0](https://github.com/janosh/elementari/compare/v0.1.8...v0.2.0)

> 8 July 2023

- Add `Lattice.svelte` [`#41`](https://github.com/janosh/elementari/pull/41)
- Show cylinder between active and hovered sites [`#40`](https://github.com/janosh/elementari/pull/40)
- Fix structure controls for `atom_radius`, `same_size_atoms` [`#38`](https://github.com/janosh/elementari/pull/38)
- Add `Bond` component [`#37`](https://github.com/janosh/elementari/pull/37)
- Split `/src/lib` into submodules [`#36`](https://github.com/janosh/elementari/pull/36)
- Add materials detail pages [`#35`](https://github.com/janosh/elementari/pull/35)
- Highlight active and hovered sites in `Structure` [`#34`](https://github.com/janosh/elementari/pull/34)
- Structure tooltips when hovering atoms [`#33`](https://github.com/janosh/elementari/pull/33)
- get started with testing Structure.svelte and structure.ts [`#32`](https://github.com/janosh/elementari/pull/32)
- Structure hide buttons on desktop until hover [`#31`](https://github.com/janosh/elementari/pull/31)
- Structure grid example [`#30`](https://github.com/janosh/elementari/pull/30)
- `Structure` allow selecting from different element color schemes + override individual elements [`#29`](https://github.com/janosh/elementari/pull/29)
- add function find_image_atoms() used in StructureScene to draw images of atoms [`3098d6c`](https://github.com/janosh/elementari/commit/3098d6c7a78eca7d47bda0a7b5da219c575883ff)
- Structure add prop show_image_atoms, expand MaterialCard to show more attrs, mp-[slug] pages sync material ID with url [`f43dd31`](https://github.com/janosh/elementari/commit/f43dd31960aed20ca454ab9adf70094a57ce7b5c)
- add Structure control bond_color + make all Structure CSS into variables [`a79ff00`](https://github.com/janosh/elementari/commit/a79ff0093b88b2ad1dd525f8ddd67a3d9278b315)
- make initial camera_position responsive to crystal size [`5b1e82a`](https://github.com/janosh/elementari/commit/5b1e82abf0e4cc63832ee36e64d17b8344954d03)
- use InstancedMesh from @threlte/extras for more efficient drawing of crystal sites [`142effb`](https://github.com/janosh/elementari/commit/142effb75f565ce9f0dbedf05bf062112744bb68)
- add API explorer page (under /api) [`2a7c60e`](https://github.com/janosh/elementari/commit/2a7c60e4feed54f068cdfb787db43990f4772fe6)
- display distance between active and hovered site in hover tooltip [`9e1af46`](https://github.com/janosh/elementari/commit/9e1af461802a49c844d20ddbc6176abb48784b59)
- add props [`c586225`](https://github.com/janosh/elementari/commit/c586225b99e5777ef8ec14cfdaa2538f3bbd3a22)
- drop valid Pymatgen structures as JSON files on Structure.svelte to display them [`7127b18`](https://github.com/janosh/elementari/commit/7127b18312a5deea4c266d42168dd0e623a0ff29)
- PeriodicTable add prop color_overrides [`1042bf2`](https://github.com/janosh/elementari/commit/1042bf2b49bd79e7932af37362e2f5884a3e3c92)
- add copy buttons to all code blocks [`7f3fb5c`](https://github.com/janosh/elementari/commit/7f3fb5c8d043309d097a400af7e267436e819880)
- fix landing page layout broken in last commit [`6f675dd`](https://github.com/janosh/elementari/commit/6f675dd6e5bca4cc244c08963786ee40485abb57)

#### [v0.1.7](https://github.com/janosh/elementari/compare/v0.1.6...v0.1.7)

> 3 May 2023

- Initial support for rendering interactive 3d structures [`#28`](https://github.com/janosh/elementari/pull/28)
- Rename ColorBar props [`#27`](https://github.com/janosh/elementari/pull/27)
- handle structure=undefined in Structure and StructureCard component [`3aa160b`](https://github.com/janosh/elementari/commit/3aa160b84371a72413bf5d8484c787c362d428dc)
- add Structure props zoom_speed, pan_speed [`b2484ed`](https://github.com/janosh/elementari/commit/b2484eda368714f7a5ffb84d3e54002db423bdc1)
- add option to show cell as surface, wireframe or not at all, add range slider for cell opacity [`072d57a`](https://github.com/janosh/elementari/commit/072d57ab91b495eb8b68d1f1b04efa3468284dc8)
- add Structure props show_vectors, vector_colors, vector_origin [`a3f4468`](https://github.com/janosh/elementari/commit/a3f44687fe44b5fa518d6d37a2d1dc2e9eb2468a)
- fix ElementTile dispatch event payload name dom_event [`f557b07`](https://github.com/janosh/elementari/commit/f557b07c8c383908d49adc63c005c5cb469e35ec)
- Structure add bindable props width, height [`3921f9d`](https://github.com/janosh/elementari/commit/3921f9d067a9e1a840b6dcbca53c27d67b4c7434)
- rename Structure-&gt;PymatgenStructure [`2009670`](https://github.com/janosh/elementari/commit/20096707f131d46a25a30f662c852f9a942479b3)

#### [v0.1.6](https://github.com/janosh/elementari/compare/v0.1.4...v0.1.6)

> 8 April 2023

- DRY workflows and ColorBar snap tick labels to nice values [`#22`](https://github.com/janosh/elementari/pull/22)
- Add unit tests for `ColorBar.svelte` [`#21`](https://github.com/janosh/elementari/pull/21)
- add prop precision: number = 2 to ElementTile [`9847290`](https://github.com/janosh/elementari/commit/9847290ac1344efd30a8a987bf8934e77b7c02a8)
- add ElementStats.test.ts [`ccc98bf`](https://github.com/janosh/elementari/commit/ccc98bf5d54b80946c429f704c076857b3fff477)
- add precision prop to ColorBar [`b9bc392`](https://github.com/janosh/elementari/commit/b9bc39247dbb4522704e0f9a000a709a59f141a5)

#### [v0.1.4](https://github.com/janosh/elementari/compare/v0.1.1...v0.1.4)

> 19 March 2023

- Add prop color_scale_range to PeriodicTable [`#20`](https://github.com/janosh/elementari/pull/20)
- Add tick labels to ColorBar [`#19`](https://github.com/janosh/elementari/pull/19)
- add test 'element tiles are accessible to keyboard users' [`314876a`](https://github.com/janosh/elementari/commit/314876a3dfe3c4ccc3a245c88607169b7a18c7dd)
- add prop text_color to ElementTile [`79b1eb4`](https://github.com/janosh/elementari/commit/79b1eb4e1e856336b891d31950fda3b4ac66e528)
- fix error msg on bad color scale names [`c1d0f2a`](https://github.com/janosh/elementari/commit/c1d0f2ac61878d35e7a16754632dc279348f68e7)

> v0.1.2 and v0.1.3 were faulty and have been unpublished.

#### [v0.1.1](https://github.com/janosh/elementari/compare/v0.1.0...v0.1.1)

> 16 March 2023

- AVIF element images [`#18`](https://github.com/janosh/elementari/pull/18)
- add src/lib/ColorBar.svelte [`1bff50c`](https://github.com/janosh/elementari/commit/1bff50c440466be02d7e47581c1b3e3ad817cb16)
- record element image provider to static/img-sources.json in src/fetch-elem-images.ts [`c3a5a91`](https://github.com/janosh/elementari/commit/c3a5a91aa35144400ef127d01bbb2a2e87669a7c)
- replace PrevNextElement.svelte with PrevNext from svelte-zoo [`4773c24`](https://github.com/janosh/elementari/commit/4773c2465c18b00fca9be1d2a608a0faf80d6147)
- show tiles of reduced opacity representing all lanth-/actinides in grid col=3, row=6/7 [`be4f88a`](https://github.com/janosh/elementari/commit/be4f88a5932c1f4eb8de25adb2d4918bd52ad78d)
- fix DemoNav active route [`887e8ce`](https://github.com/janosh/elementari/commit/887e8ce4a81e43566d42303f38b933d86e4f968d)
- update svelte-package to v2 [`0e61a9d`](https://github.com/janosh/elementari/commit/0e61a9dce4332adb215df2b191b101f1b6f74135)
- add CmdPalette for keyboard-only site navigation [`8a82f55`](https://github.com/janosh/elementari/commit/8a82f55a6b05d31d831e0c3c5c49a6d7d7eb4d8c)

#### v0.1.0

> 14 February 2023

- prepare NPM Release [`#16`](https://github.com/janosh/elementari/pull/16)
- Deploy site to GitHub Pages [`#15`](https://github.com/janosh/elementari/pull/15)
- add test 'hooking PeriodicTable up to PropertySelect and selecting heatmap sets element tile background' [`#14`](https://github.com/janosh/elementari/pull/14)
- convert `src/lib/element-data.{ts -> yml}` [`#13`](https://github.com/janosh/elementari/pull/13)
- Migrate to PNPM [`#12`](https://github.com/janosh/elementari/pull/12)
- Update scatter tooltip when hovering element tiles [`#9`](https://github.com/janosh/elementari/pull/9)
- SvelteKit auto migration [`#8`](https://github.com/janosh/elementari/pull/8)
- [pre-commit.ci] pre-commit autoupdate [`#5`](https://github.com/janosh/elementari/pull/5)
- Add fill area below elemental periodicity line plot [`#4`](https://github.com/janosh/elementari/pull/4)
- add individual element detail pages (closes #1) [`#1`](https://github.com/janosh/elementari/issues/1)
- split ActiveElement.svelte into TableInset + ElementStats + ElementPhoto (closes #2, closes #3) [`#2`](https://github.com/janosh/elementari/issues/2) [`#3`](https://github.com/janosh/elementari/issues/3)
- revert #13 `src/lib/element-data.{yml -> ts}` [`b181839`](https://github.com/janosh/elementari/commit/b1818397184d72e8ee229165fba38a2cebc0ee59)
- initial commit [`feeae8f`](https://github.com/janosh/elementari/commit/feeae8f84678316b408a1bf4f3bfc269901a73b9)
- add src/lib/Nucleus.svelte along with demo src/routes/(demos)/nucleus/+page.svx [`b148e54`](https://github.com/janosh/elementari/commit/b148e54609da3e744da8f6a70c45783f85039fc5)
- spice up ElementStats and element detail pages with iconify icons [`4eace91`](https://github.com/janosh/elementari/commit/4eace919af8b49ec44b261892a3df5cc6cf3db2b)
- add color-scale + element-tile demo page [`664e8f5`](https://github.com/janosh/elementari/commit/664e8f5a89a353fa4c72fd8b16d9e091a63cbd56)
- add ability to plot predefined heat maps [`71459fa`](https://github.com/janosh/elementari/commit/71459fab6283acda6d11a552896d252aa4683fb0)
- rename package and repo to elementari [`1921efe`](https://github.com/janosh/elementari/commit/1921efe5f02c5eadcf0e62cecafd657f0b0b99b4)
- split ScatterPlot into data-agnostic ScatterPlot and ElementScatter [`ea7e57f`](https://github.com/janosh/elementari/commit/ea7e57f4af01da8db88384b196210fb7faedd358)
- add show icons toggle to Footer [`7649f90`](https://github.com/janosh/elementari/commit/7649f9074e41b2906224ddeb14015f59961d535a)
- add katex math rendering to markdown and mdsvex [`81ce9b3`](https://github.com/janosh/elementari/commit/81ce9b3c3925f19eaa7337dd8e8af804cb0ad286)
- rename package and repo to sveriodic-table [`7867167`](https://github.com/janosh/elementari/commit/7867167760baa84416890c0329c48175ee13a038)
- fix scatter point fill color, `mv {ChemicalElement->ElementTile}.svelte`, now controlled externally by PeriodicTable.svelte [`9d10109`](https://github.com/janosh/elementari/commit/9d10109ffec04d2b4c5a58fb37c9920fda6712aa)
- add PrevNextElement.svelte to element detail pages [`266fab3`](https://github.com/janosh/elementari/commit/266fab336c5e4f9abc46d611647435ae6181c03f)
- fix ColorCustomizer which had zero effect since adding heatmap functionality [`80dcfb0`](https://github.com/janosh/elementari/commit/80dcfb0d52d9acbdbaf69ea6b23b5fd57d8891c5)
- ptable color_scale prop now takes d3-scale-chromatic scale names or any function mapping [0,1] to color strings [`84060cd`](https://github.com/janosh/elementari/commit/84060cded5c05f3dd4c7007c1d0b78c28c020c90)
- show table of electron occupations per orbital in element detail page [`c3580c0`](https://github.com/janosh/elementari/commit/c3580c00030bad268b7701e500278ab0dfb0dc45)
- add __layout +__error pages [`ffe433e`](https://github.com/janosh/elementari/commit/ffe433ec30acc29acffe194afbf9e3d86ec1ddd1)
- show PeriodicTable on element detail pages [`b7d1313`](https://github.com/janosh/elementari/commit/b7d1313a3233e4fe2989906a583e8a5c1a808b8b)
- improve detail page layout [`b6cf71a`](https://github.com/janosh/elementari/commit/b6cf71af4c0418955253ca23ca1bd89db49942c3)
- fix oversights [`4f40e97`](https://github.com/janosh/elementari/commit/4f40e9738a470c61847a33c503f12cd271e58001)
- improve test coverage for periodic table in heatmap mode and Bohr atoms page [`343662b`](https://github.com/janosh/elementari/commit/343662b7a8dfd40b7dfc59f34c2a623e2d7367ee)
- move types into src/lib/index.ts [`b706882`](https://github.com/janosh/elementari/commit/b7068822b8b305de551393e379bdfa49ca31cf6f)
- pnpm add -D d3-color to set ElementTile text_color based on lightness of bg_color [`a0b82fd`](https://github.com/janosh/elementari/commit/a0b82fdc4bef6e794d4697939bcb9391d7f4dcc5)
- add color scale ramp slots to ColorScaleSelect to provide visual preview of color scale [`ebcb0a3`](https://github.com/janosh/elementari/commit/ebcb0a32456dcfbff0686c0a948780adb4c8f382)
- pnpm add -D svelte-zoo mdsvexamples [`1a76bae`](https://github.com/janosh/elementari/commit/1a76bae0eb8cf074ec17246460e95bc6815b9de9)
- keep scroll pos on element tile links [`2dbc382`](https://github.com/janosh/elementari/commit/2dbc38207ad4b1acbdb6b7dbc54df045e160179b)
- add basic E2E tests and run in CI on push & pull to main branch [`e031919`](https://github.com/janosh/elementari/commit/e03191935775c4853091220624773942835edfc3)
- add ScatterPlot into TableInset showing periodicity trends when heat map selected [`efd2ed6`](https://github.com/janosh/elementari/commit/efd2ed6f1705c2ae92d7dbcf18ad0b9a560a52c9)
- add EasterEgg.svelte [`c8959ba`](https://github.com/janosh/elementari/commit/c8959badde4b777f83f01dbf941c5a3086a1c5b7)
- delete 'boil' key in periodic-table-data.ts [`e8eb1cf`](https://github.com/janosh/elementari/commit/e8eb1cf846beced5c86990afffcefa7c2047dc7a)
- move ColorCustomizer from PeriodicTable to index.svelte and hide it when in heatmap mode [`688a0bd`](https://github.com/janosh/elementari/commit/688a0bd3650d89f8f92b76488c1bbc80da64881d)
- remove EasterEgg.svelte from landing page [`686c904`](https://github.com/janosh/elementari/commit/686c904f8046a7ae28ce325e5dee78b78d94a8ad)
- improve element tile and element stats inset screen width responsiveness [`7b2b762`](https://github.com/janosh/elementari/commit/7b2b7628d132a27bf3fcd8a581c7156b6695f016)
- only wrap ElementTile in `<a>` if passed href prop, else `<div>` [`d8643c8`](https://github.com/janosh/elementari/commit/d8643c8133f27b058b0992c019d134e4b27f96b8)
- add vitest unit tests [`fad1b3a`](https://github.com/janosh/elementari/commit/fad1b3a90176bdb5ffd45168adc81f943fd2dbb8)
- add contributing.md [`3033f6e`](https://github.com/janosh/elementari/commit/3033f6e6b30856f66adaee689ea5f6f432ffa644)
- add tests 'clicking element tile emits event', 'gap prop' and 'setting active_category=%s highlights corresponding element tiles' [`36e757d`](https://github.com/janosh/elementari/commit/36e757d29ee47a3db015c8de433b148ba5a23ccc)
- fix pretty_num() raising TypeError: Cannot read properties of null (reading 'toExponential') [`fa81d29`](https://github.com/janosh/elementari/commit/fa81d2977296d1a9159b5873e1079cb8f5138b77)
- use src/(routes|lib)/index.ts convenience imports internally [`35f7fbe`](https://github.com/janosh/elementari/commit/35f7fbe8e1019d0813f2fcd5cbf5f364b9174bdb)
- move heatmap + color_scale to svelte stores [`0bb686b`](https://github.com/janosh/elementari/commit/0bb686b05399d63829ec27d57ff7b95b1f7ef790)
- allow navigating periodic table and detail pages with arrow keys [`8ffef5b`](https://github.com/janosh/elementari/commit/8ffef5b4e02578b18eaf4d4eb2999a2d40b93508)
- reduce max-width landing page ptable, negative margins on bohr atom demo, replace Toggle with svelte-zoo's Toggle [`8e4c90a`](https://github.com/janosh/elementari/commit/8e4c90a58e05ece552bb662662df0cf8f15cc63f)
- PeriodicTable forward click, mouseenter, mouseleave, keyup, keydown events from ElementTile [`13db2fa`](https://github.com/janosh/elementari/commit/13db2fa6cd32637e5a468496a07ea45de622f728)
- add src/fetch-elem-images.ts to download element photos to static assets [`a2dff38`](https://github.com/janosh/elementari/commit/a2dff384e2642f9c4d0916dbc9178b19ed508744)
- fix Bohr electron orbital speed [`ff3af1a`](https://github.com/janosh/elementari/commit/ff3af1af12ef9d6c67fb673cd048028ea424317e)
- fix ScatterPlot label and grid offset [`942719b`](https://github.com/janosh/elementari/commit/942719b2e7f3f896406e909f93cc57a4eca9cc3a)
- declare module periodic-table-data.ts + clean up [`6b9f717`](https://github.com/janosh/elementari/commit/6b9f7178246a9aee0c02c6abe634811eb95f6650)
- add coverage badges to readme [`39da8c1`](https://github.com/janosh/elementari/commit/39da8c16000676a6381989a7dffd295cf727f6a6)
- add hover tooltip for scatter plot [`0745307`](https://github.com/janosh/elementari/commit/07453070fdd77862279adeede2fead33fd3372bf)
- add ElementTile unit tests `'show_${prop} toggles ${prop} visibility'` and 'applies class active when active=true' [`fd8c33f`](https://github.com/janosh/elementari/commit/fd8c33f8edc21d007a17fae8c22bd6f37c245eb6)
- add prop gap = `0.3cqw` between element tiles, default is 0.3% of container width [`aa6b503`](https://github.com/janosh/elementari/commit/aa6b503cca26e22d1aa5cb5305866f3add2ecff7)
- add npm install cmd to readme [`d8e15e9`](https://github.com/janosh/elementari/commit/d8e15e9cb7f0e648c5342672eceb5d88723d18b0)
- add src/lib/BohrAtom.svelte [`ccb8e02`](https://github.com/janosh/elementari/commit/ccb8e020704884c30c813cb1ef05ba1ec81cf589)
- fix scatter plot not showing on element detail pages without photo [`9501bbb`](https://github.com/janosh/elementari/commit/9501bbbfe2f24541e4a8db3ab7192702653744d7)
- ElementTile use text color also for active/hover border [`178c27e`](https://github.com/janosh/elementari/commit/178c27e375a37f0979ce51c31f84b6a5b4ec8625)
- add BohrAtom to [slug].svelte [`6b3a71d`](https://github.com/janosh/elementari/commit/6b3a71d1ad675252f1df926618a4186d0d9b0fc2)
- add src/lib/Toggle.svelte [`a80df20`](https://github.com/janosh/elementari/commit/a80df20d7007fb66f5fe1b4e04e2cd2e9ee4264c)
- add x and y axes to ScatterPlot.svelte [`f6f8325`](https://github.com/janosh/elementari/commit/f6f8325d1d9f76861df0c53ea832a3833762284c)
- add prop highlight_shell to BohrAtom.svelte [`5741f34`](https://github.com/janosh/elementari/commit/5741f348c12339e613a91aa035d5ca961d75f141)
- improve SEO meta tags on index and [slug] pages [`abb5152`](https://github.com/janosh/elementari/commit/abb515269ef6e0da5b2e8d7962b14da711242551)
- add script src/update-site-screenshots.ts [`b70e8bd`](https://github.com/janosh/elementari/commit/b70e8bd1e8b3f5237e1186fe1ef13d0dc896b64b)
- add src/lib/PropertySelect.svelte used byindex.svelte and [slug].svelte [`2654347`](https://github.com/janosh/elementari/commit/2654347ebfe27ba9bac11e04dc8e3ad7c6371d53)
- incl logo in readme heading, update deps, fix error page offline warning [`415e788`](https://github.com/janosh/elementari/commit/415e788d62d2e770d961cedb6f8e2f82ae9c72e9)
- simplify svg coords in BohrAtom.svelte by placing origin in <svg> center [`3511ca4`](https://github.com/janosh/elementari/commit/3511ca445975f2f9654a4d02eba9c05cf1ca94f7)
- move d3-array, d3-interpolate-path, d3-shape, d3-scale, @iconify/svelte from package devDeps to deps [`f901471`](https://github.com/janosh/elementari/commit/f90147114cb46112222e2a8d89e22144e2081f90)
- add src/routes/bohr-atoms.svelte [`b77abe8`](https://github.com/janosh/elementari/commit/b77abe868e9c4fe62831c19380ffb5158b1a0f92)
- use new SvelteKit snapshot feature to restore color scale on browser back navigation [`edf121d`](https://github.com/janosh/elementari/commit/edf121debc2a02c455a46af134802e5ea96fa3d4)
- add element detail page screen recording to readme [`88a27be`](https://github.com/janosh/elementari/commit/88a27bebb8deda53ed75724622b1c3ab231a1c2b)
- add toggle to start/stop electrons orbiting nucleus [`fcd9022`](https://github.com/janosh/elementari/commit/fcd9022ceea8e8ed18a2a5633fd6a8fac41e2b87)
- fix density unit to g/liter for gases instead of g/cm^3 for solids/liquids [`a145443`](https://github.com/janosh/elementari/commit/a145443a69c3ab1e4c42902f440308f506df3ce3)
- export active_element + active_category from PeriodicTable.svelte [`56ce7e3`](https://github.com/janosh/elementari/commit/56ce7e38e6314dd1afab2422e0af137e30a618f4)
- move non-package components to new src/site dir [`14440ae`](https://github.com/janosh/elementari/commit/14440aea8d4d83cde00e6cc43d7cfe8e97c91f26)
- hide element names if `windowWidth < 1000` to prevent text overflow [`905d932`](https://github.com/janosh/elementari/commit/905d93221059708eb9e77b8cbbd4d8342c497140)
- drop year heatmap, add covalent_radius + first_ionization instead [`6b2953e`](https://github.com/janosh/elementari/commit/6b2953e049a340c830ef0a8e2b7a70595824f88c)
- keep increased brightness on last-active element [`b441c78`](https://github.com/janosh/elementari/commit/b441c78fef0f2015038b06716619a48af9fccda3)
- update index page screenshot [`853cd18`](https://github.com/janosh/elementari/commit/853cd181bc16fa61dc67062f265ed272cc3c2e86)
- tweak ColorCustomizer.svelte CSS [`cdcf92e`](https://github.com/janosh/elementari/commit/cdcf92e405a50417a416d18b534292a4bdd8dfa7)
- group demo routes [`89aae68`](https://github.com/janosh/elementari/commit/89aae68e0a0dd1ac31b34eaa01a0fe787be15685)
- add ScatterPlot axis labels [`65fdc41`](https://github.com/janosh/elementari/commit/65fdc41b36ee1aa0666a180f925fcd592451101f)
- change import to import type for purely type imports [`ac53e0e`](https://github.com/janosh/elementari/commit/ac53e0e1d172e69e506cb9de0a593ac9021b5d3f)
- display BohrAtom in PeriodicTable if window width permits [`c5aacdc`](https://github.com/janosh/elementari/commit/c5aacdc100e3aaf8e69eced79046ca5f400eefc0)
- make ScatterPlot always show current element on detail pages unless user actively hovers another element [`6a4c021`](https://github.com/janosh/elementari/commit/6a4c021e6c53a6a815d22a97b679680e3d17c8c1)
- document BohrAtom.svelte props [`bc100c2`](https://github.com/janosh/elementari/commit/bc100c221961f312641c1ba4f959b6aff3bff96c)
- reinstate default category color css variables [`7dae519`](https://github.com/janosh/elementari/commit/7dae519f6e4b155945699a40482564f755372840)
- acknowledge images-of-elements.com and github.com/kadinzhang/Periodicity in readme [`92d9941`](https://github.com/janosh/elementari/commit/92d9941b1d274bf9a827399532a32aa2d40071df)
- link to /bohr-atoms page from footer [`eca7889`](https://github.com/janosh/elementari/commit/eca7889d304203b39de0207bdcbf9a70efa5839a)
- silence sveltekit tsconfig warning [`c3a4a0c`](https://github.com/janosh/elementari/commit/c3a4a0c5e8072c896dfa0f576a8ee3ed400a55b5)
- mv src/lib/graph/* src/lib [`2d7eb2f`](https://github.com/janosh/elementari/commit/2d7eb2f64e13034b3dfca3e504259be37871028d)
- add screenshot to readme [`54084ed`](https://github.com/janosh/elementari/commit/54084ed70ddb1de81a1800dbd02f30af4a30ea2f)
