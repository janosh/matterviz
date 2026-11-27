import { compact_formula, format_formula_html } from '#lib/composition/formula-markup'
import FormulaText from '#lib/composition/FormulaText.svelte'
import { sanitize_html } from '#lib/sanitize'
import { mount } from 'svelte'
import { expect, test } from 'vite-plus/test'

// FormulaText mounted into a detached div
const mount_formula_text = (text: string): HTMLDivElement => {
  const target = document.createElement(`div`)
  mount(FormulaText, { target, props: { text } })
  return target
}
// its markup, minus svelte's comment anchors and scoped style classes
const formula_text_html = (text: string): string =>
  mount_formula_text(text)
    .innerHTML.replaceAll(/<!--[^>]*-->/g, ``)
    .replaceAll(/ class="[^"]*"/g, ``)
// The DOM that {@html sanitize_html(format_formula_html(formula))} produces
const formula_html = (formula: string): string => {
  const div = document.createElement(`div`)
  div.innerHTML = sanitize_html(format_formula_html(formula))
  return div.innerHTML
}

// Standard typography from both renderers for a compacted formula: counts and stoichiometric
// expressions subscripted, charges and isotope masses superscripted, coefficients, prefixes and
// state labels full size
test.each([
  // pymatgen spacing, decimals
  [`Ac6 U2`, `Ac<sub>6</sub>U<sub>2</sub>`],
  [`Li0.5 Fe O2`, `Li<sub>0.5</sub>FeO<sub>2</sub>`],
  [`Li.5CoO2`, `Li<sub>.5</sub>CoO<sub>2</sub>`],
  [`Fe0.95O`, `Fe<sub>0.95</sub>O`],
  [`BAs`, `BAs`],
  // a letter run that is a real symbol keeps its n/y (SnO2, not SₙO2)
  [`SnO2`, `SnO<sub>2</sub>`],
  [`InP`, `InP`],
  [`Dy2O3`, `Dy<sub>2</sub>O<sub>3</sub>`],
  [`LiNi1/3Co1/3Mn1/3O2`, `LiNi<sub>1/3</sub>Co<sub>1/3</sub>Mn<sub>1/3</sub>O<sub>2</sub>`],
  [`Fe`, `Fe`],
  [``, ``],
  [`   `, ``],
  // groups at any depth and with any bracket
  [`Li3 Fe2 (P O4)3`, `Li<sub>3</sub>Fe<sub>2</sub>(PO<sub>4</sub>)<sub>3</sub>`],
  [`(NH4)2SO4`, `(NH<sub>4</sub>)<sub>2</sub>SO<sub>4</sub>`],
  [`Ca3(Fe(CN)6)2`, `Ca<sub>3</sub>(Fe(CN)<sub>6</sub>)<sub>2</sub>`],
  [`K4[Fe(CN)6]`, `K<sub>4</sub>[Fe(CN)<sub>6</sub>]`],
  [`[Co(NH3)6]Cl3`, `[Co(NH<sub>3</sub>)<sub>6</sub>]Cl<sub>3</sub>`],
  [`K3{Fe(CN)6}`, `K<sub>3</sub>{Fe(CN)<sub>6</sub>}`],
  // comma-separated sites sharing a position
  [`(Ba,Sr)TiO3`, `(Ba,Sr)TiO<sub>3</sub>`],
  [`Pb(Zr,Ti)O3`, `Pb(Zr,Ti)O<sub>3</sub>`],
  [`(Mg,Fe)2SiO4`, `(Mg,Fe)<sub>2</sub>SiO<sub>4</sub>`],
  [
    `Ca2(Mg,Fe)5Si8O22(OH)2`,
    `Ca<sub>2</sub>(Mg,Fe)<sub>5</sub>Si<sub>8</sub>O<sub>22</sub>(OH)<sub>2</sub>`,
  ],
  // variable stoichiometry (x, y, z, n, δ), incl. a Unicode minus
  [`LixCoO2`, `Li<sub>x</sub>CoO<sub>2</sub>`],
  [`InxGa1-xN`, `In<sub>x</sub>Ga<sub>1-x</sub>N`],
  [`Cd1-xZnxTe`, `Cd<sub>1-x</sub>Zn<sub>x</sub>Te`],
  [`MnxCo3-xO4`, `Mn<sub>x</sub>Co<sub>3-x</sub>O<sub>4</sub>`],
  [`CHnCl4-n`, `CH<sub>n</sub>Cl<sub>4-n</sub>`],
  [`Ti3C2Tx`, `Ti<sub>3</sub>C<sub>2</sub>T<sub>x</sub>`],
  [`Li1-xFePO4`, `Li<sub>1-x</sub>FePO<sub>4</sub>`],
  [`Li1−xCoO2`, `Li<sub>1−x</sub>CoO<sub>2</sub>`],
  [`Ba(1-x)SrxTiO3`, `Ba<sub>(1-x)</sub>Sr<sub>x</sub>TiO<sub>3</sub>`],
  [`La1-xSrxMnO3`, `La<sub>1-x</sub>Sr<sub>x</sub>MnO<sub>3</sub>`],
  [`Li(1+x)Mn(2-x)O4`, `Li<sub>(1+x)</sub>Mn<sub>(2-x)</sub>O<sub>4</sub>`],
  [`MgxFe1-xSiO4`, `Mg<sub>x</sub>Fe<sub>1-x</sub>SiO<sub>4</sub>`],
  [`CuO2-δ`, `CuO<sub>2-δ</sub>`],
  [`Fe0.5Oδ`, `Fe<sub>0.5</sub>Oδ`],
  [`YBa2Cu3O7-δ`, `YBa<sub>2</sub>Cu<sub>3</sub>O<sub>7-δ</sub>`],
  [`CxHy`, `C<sub>x</sub>H<sub>y</sub>`],
  [`NOx`, `NO<sub>x</sub>`],
  [`(CH2)n`, `(CH<sub>2</sub>)<sub>n</sub>`],
  // isotopes
  [`D2O`, `D<sub>2</sub>O`],
  [`T2O`, `T<sub>2</sub>O`],
  [`^13CO2`, `<sup>13</sup>CO<sub>2</sub>`],
  [`¹³CO2`, `¹³CO<sub>2</sub>`],
  // hydrates, adducts and coefficients stay full size
  [`CuSO4·5H2O`, `CuSO<sub>4</sub>·5H<sub>2</sub>O`],
  [`2H2+O2->2H2O`, `2H<sub>2</sub>+O<sub>2</sub>-&gt;2H<sub>2</sub>O`],
  [`Na2CO3·10H2O`, `Na<sub>2</sub>CO<sub>3</sub>·10H<sub>2</sub>O`],
  [`CaSO4·0.5H2O`, `CaSO<sub>4</sub>·0.5H<sub>2</sub>O`],
  [`CuSO4•5H2O`, `CuSO<sub>4</sub>•5H<sub>2</sub>O`],
  [`CuSO4*5H2O`, `CuSO<sub>4</sub>*5H<sub>2</sub>O`],
  [`NaxCoO2·yH2O`, `Na<sub>x</sub>CoO<sub>2</sub>·yH<sub>2</sub>O`],
  [`xLi2MnO3·(1-x)LiCoO2`, `xLi<sub>2</sub>MnO<sub>3</sub>·(1-x)LiCoO<sub>2</sub>`],
  [`2H2O`, `2H<sub>2</sub>O`],
  // charges: caret syntax, or a bare sign after the count (trailing digits are always a count)
  [`SO4^2-`, `SO<sub>4</sub><sup>2-</sup>`],
  [`Fe^3+`, `Fe<sup>3+</sup>`],
  [`Fe^2+O3`, `Fe<sup>2+</sup>O<sub>3</sub>`],
  [`Fe2^3+O3^2-`, `Fe<sub>2</sub><sup>3+</sup>O<sub>3</sub><sup>2-</sup>`],
  [`Na^+Cl^-`, `Na<sup>+</sup>Cl<sup>-</sup>`],
  [`Fe(OH)^2+`, `Fe(OH)<sup>2+</sup>`],
  [`[Fe(CN)6]^4-`, `[Fe(CN)<sub>6</sub>]<sup>4-</sup>`],
  [`NH4+`, `NH<sub>4</sub><sup>+</sup>`],
  [`OH-`, `OH<sup>-</sup>`],
  [`OH−`, `OH<sup>−</sup>`],
  [`SO4^2−`, `SO<sub>4</sub><sup>2−</sup>`],
  [`Cu^+`, `Cu<sup>+</sup>`],
  // a lone ion with a bare sign stays plain, like a suspended hyphen (Fe- and Co-based)
  [`Li+`, `Li+`],
  [`Cl-`, `Cl-`],
  [`O2-`, `O<sub>2</sub><sup>-</sup>`],
  [`Fe3+`, `Fe<sub>3</sub><sup>+</sup>`],
  // phase and polymorph prefixes, state labels
  [`α-Fe2O3`, `α-Fe<sub>2</sub>O<sub>3</sub>`],
  [`β-Ga2O3`, `β-Ga<sub>2</sub>O<sub>3</sub>`],
  [`H2O(l)`, `H<sub>2</sub>O(l)`],
  [`CO2(g)`, `CO<sub>2</sub>(g)`],
  [`NaCl(aq)`, `NaCl(aq)`],
  [`2H-MoS2`, `2H-MoS<sub>2</sub>`],
  [`1T'-WTe2`, `1T'-WTe<sub>2</sub>`],
  [`Fe-Fe3C`, `Fe-Fe<sub>3</sub>C`],
  [`La2NiO4 + NiO`, `La<sub>2</sub>NiO<sub>4</sub>+NiO`],
  [`mp-1234`, `mp-1234`],
])(`%j renders as %s in format_formula_html and FormulaText`, (formula, expected) => {
  const compact = compact_formula(formula)
  expect(formula_html(compact)).toBe(expected)
  expect(formula_text_html(compact)).toBe(expected)
})

// Whole-string formatting only: a variable letter that a word goes on from stays (Hex_A3 is no
// Heₓ), and a spaced hydrate dot still makes the next number a coefficient
test.each([
  [`Hex_A3`, `Hex_A<sub>3</sub>`],
  [`CuSO4 · 5H2O`, `CuSO<sub>4</sub> · 5H<sub>2</sub>O`],
])(`format_formula_html(%j) → %s`, (formula, expected) => {
  expect(formula_html(formula)).toBe(expected)
})

// In free text only formula words are marked up: prose numbers, citations, units, space groups,
// method names and redox pairs stay plain
test.each([
  [`(see 2)`, `(see 2)`],
  [`Fig. 2`, `Fig. 2`],
  [`model v2`, `model v2`],
  [`Ref. 2(a)`, `Ref. 2(a)`],
  [`Eq. (3)`, `Eq. (3)`],
  [`see [12]`, `see [12]`],
  [`T(K)`, `T(K)`],
  [`E(eV)`, `E(eV)`],
  [`x(Li)`, `x(Li)`],
  [`f(x)`, `f(x)`],
  [`m^2`, `m^2`],
  [`s^-1`, `s^-1`],
  [`SiO2/Al2O3`, `SiO2/Al2O3`],
  [`P6_3/mmc`, `P6_3/mmc`],
  [`I4/mmm`, `I4/mmm`],
  [`Fe^2+/Fe^3+`, `Fe^2+/Fe^3+`],
  [`Mn^2+/Mn^3+ couple`, `Mn^2+/Mn^3+ couple`],
  [`PBE-D3`, `PBE-D3`],
  [`T1 relaxation`, `T1 relaxation`],
  [`2D view`, `2D view`],
  [`By default`, `By default`],
  [`Hex_A3`, `Hex_A3`],
  [`Li-ion`, `Li-ion`],
  [`CONTCAR2`, `CONTCAR2`], // A and R are no elements
  [`no formula here`, `no formula here`],
  [`mp-1234`, `mp-1234`],
  [`LiCoO2 C2/m`, `LiCoO<sub>2</sub> C2/m`],
  [`P2_1/c`, `P2_1/c`],
  [`Fe- and Co-based alloys`, `Fe- and Co-based alloys`],
  [`Ni-, Co- and Mn-rich`, `Ni-, Co- and Mn-rich`],
  [`O- and N-doped`, `O- and N-doped`],
  [`Table S1`, `Table S<sub>1</sub>`], // indistinguishable from the formula S1
  // formulas inside prose
  [`BaTiO3 cubic perovskite`, `BaTiO<sub>3</sub> cubic perovskite`],
  [`Li2O_relax.traj`, `Li<sub>2</sub>O_relax.traj`],
  [`SnxO2 film`, `Sn<sub>x</sub>O<sub>2</sub> film`],
  [`CuSO4 · 5H2O`, `CuSO<sub>4</sub> · 5H<sub>2</sub>O`],
  [`Li3 Fe2 (P O4)3`, `Li<sub>3</sub> Fe<sub>2</sub> (P O<sub>4</sub>)<sub>3</sub>`],
  [`(LiCoO2 cathode)`, `(LiCoO<sub>2</sub> cathode)`],
  [`LiCoO2-based`, `LiCoO<sub>2</sub>-based`],
  [`LiFePO4 (olivine) run 2`, `LiFePO<sub>4</sub> (olivine) run 2`],
  [`Ca(OH`, `Ca(OH`],
  [`LiFePO4.`, `LiFePO<sub>4</sub>.`],
  [`Li0.5Coα`, `Li0.5Coα`], // no partial count (Li₀.5)
  [`Fe^2+ and Fe^3+`, `Fe<sup>2+</sup> and Fe<sup>3+</sup>`],
  [`NOx emissions`, `NO<sub>x</sub> emissions`],
  [`D2O vs H2O`, `D<sub>2</sub>O vs H<sub>2</sub>O`],
  [`α-Fe2O3 film`, `α-Fe<sub>2</sub>O<sub>3</sub> film`],
  [`NaxCoO2·yH2O film`, `Na<sub>x</sub>CoO<sub>2</sub>·yH<sub>2</sub>O film`],
])(`FormulaText(%j) → %s`, (text, expected) => {
  expect(formula_text_html(text)).toBe(expected)
})

// Markup in the text is shown as text, never parsed into elements
test.each([
  `<script>alert(1)</script>`,
  `Fe<img src=x onerror=alert(1)>2O3`,
  `<b>Fe</b>2O3`,
  `Fe2O3<br>`,
])(`renders %j as text`, (text) => {
  const target = mount_formula_text(text)
  expect(target.textContent).toBe(text)
  const tags = [...target.querySelectorAll(`*`)].map((el) => el.tagName.toLowerCase())
  expect(tags.every((tag) => tag === `sub` || tag === `sup`)).toBe(true)
})
