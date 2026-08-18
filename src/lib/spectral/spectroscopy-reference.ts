import type { SpectralActivity } from './trajectory-spectroscopy'
import { SvelteSet } from 'svelte/reactivity'

export interface ReferenceCitation {
  id: string
  title: string
  authors: string
  year: number
  url: string
  doi?: string
  locator: string
  access_date: string
  redistribution_rationale: string
}

export interface VibrationalReferenceMode {
  mode_id: string
  label: string
  symmetry?: string
  mode_type?: string
  degeneracy: number
  wavenumber_cm1: number
  ir_activity: SpectralActivity
  raman_activity: SpectralActivity
  citation_id: string
}

export interface VibrationalReferenceEntry {
  id: string
  name: string
  formula: string
  isotopologue: string
  phase: string
  frequency_unit: `cm^-1`
  cas_number: string
  inchikey: string
  citations: ReferenceCitation[]
  modes: VibrationalReferenceMode[]
  comparison_url?: string
}

export interface ExperimentalSpectrum {
  kind: `ir` | `raman`
  frequencies_cm1: number[]
  intensities: number[]
  source: string
  temperature?: number
}

const is_record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === `object` && !Array.isArray(value)

const require_string = (value: unknown, path: string): string => {
  if (typeof value !== `string` || !value.trim())
    throw new TypeError(`${path} must be a non-empty string`)
  return value
}

const require_number = (value: unknown, path: string): number => {
  if (typeof value !== `number` || !Number.isFinite(value))
    throw new TypeError(`${path} must be finite`)
  return value
}

const require_activity = (value: unknown, path: string): SpectralActivity => {
  if (value !== `active` && value !== `inactive` && value !== `unknown`) {
    throw new TypeError(`${path} must be active, inactive, or unknown`)
  }
  return value
}

// Validate a caller-supplied vibrational reference without coercing malformed fields.
export function parse_vibrational_reference_catalog(
  value: unknown,
): VibrationalReferenceEntry[] {
  if (!Array.isArray(value))
    throw new TypeError(`Vibrational reference catalog must be an array`)
  const ids = new SvelteSet<string>()
  return value.map((entry_value, entry_idx) => {
    const path = `catalog[${entry_idx}]`
    if (!is_record(entry_value)) throw new TypeError(`${path} must be an object`)
    const id = require_string(entry_value.id, `${path}.id`)
    if (ids.has(id)) throw new TypeError(`${path}.id duplicates '${id}'`)
    ids.add(id)
    if (!Array.isArray(entry_value.citations) || entry_value.citations.length === 0) {
      throw new TypeError(`${path}.citations must be a non-empty array`)
    }
    const citation_ids_seen = new SvelteSet<string>()
    const citations = entry_value.citations.map((citation_value, citation_idx) => {
      const citation_path = `${path}.citations[${citation_idx}]`
      if (!is_record(citation_value)) throw new TypeError(`${citation_path} must be an object`)
      const citation_id = require_string(citation_value.id, `${citation_path}.id`)
      if (citation_ids_seen.has(citation_id)) {
        throw new TypeError(`${citation_path}.id duplicates '${citation_id}'`)
      }
      citation_ids_seen.add(citation_id)
      const access_date = require_string(
        citation_value.access_date,
        `${citation_path}.access_date`,
      )
      if (!/^\d{4}-\d{2}-\d{2}$/.test(access_date)) {
        throw new TypeError(`${citation_path}.access_date must use YYYY-MM-DD`)
      }
      const [access_year, access_month, access_day] = access_date.split(`-`).map(Number)
      const parsed_access_date = new Date(Date.UTC(access_year, access_month - 1, access_day))
      if (
        parsed_access_date.getUTCFullYear() !== access_year ||
        parsed_access_date.getUTCMonth() !== access_month - 1 ||
        parsed_access_date.getUTCDate() !== access_day
      ) {
        throw new TypeError(`${citation_path}.access_date must be a valid calendar date`)
      }
      const year = require_number(citation_value.year, `${citation_path}.year`)
      if (!Number.isInteger(year) || year < 1) {
        throw new TypeError(`${citation_path}.year must be a positive integer`)
      }
      return {
        id: citation_id,
        title: require_string(citation_value.title, `${citation_path}.title`),
        authors: require_string(citation_value.authors, `${citation_path}.authors`),
        year,
        url: require_string(citation_value.url, `${citation_path}.url`),
        ...(citation_value.doi !== undefined && {
          doi: require_string(citation_value.doi, `${citation_path}.doi`),
        }),
        locator: require_string(citation_value.locator, `${citation_path}.locator`),
        access_date,
        redistribution_rationale: require_string(
          citation_value.redistribution_rationale,
          `${citation_path}.redistribution_rationale`,
        ),
      }
    })
    const citation_ids = new SvelteSet(citations.map(({ id: citation_id }) => citation_id))
    if (!Array.isArray(entry_value.modes) || entry_value.modes.length === 0) {
      throw new TypeError(`${path}.modes must be a non-empty array`)
    }
    const mode_ids = new SvelteSet<string>()
    const modes = entry_value.modes.map((mode_value, mode_idx) => {
      const mode_path = `${path}.modes[${mode_idx}]`
      if (!is_record(mode_value)) throw new TypeError(`${mode_path} must be an object`)
      const mode_id = require_string(mode_value.mode_id, `${mode_path}.mode_id`)
      if (mode_ids.has(mode_id)) {
        throw new TypeError(`${mode_path}.mode_id duplicates '${mode_id}'`)
      }
      mode_ids.add(mode_id)
      const citation_id = require_string(mode_value.citation_id, `${mode_path}.citation_id`)
      if (!citation_ids.has(citation_id)) {
        throw new TypeError(
          `${mode_path}.citation_id '${citation_id}' is not declared by the entry`,
        )
      }
      const degeneracy = require_number(mode_value.degeneracy, `${mode_path}.degeneracy`)
      if (!Number.isInteger(degeneracy) || degeneracy < 1) {
        throw new TypeError(`${mode_path}.degeneracy must be a positive integer`)
      }
      const wavenumber_cm1 = require_number(
        mode_value.wavenumber_cm1,
        `${mode_path}.wavenumber_cm1`,
      )
      if (!(wavenumber_cm1 > 0)) throw new TypeError(`${mode_path}.wavenumber_cm1 must be > 0`)
      return {
        mode_id,
        label: require_string(mode_value.label, `${mode_path}.label`),
        ...(typeof mode_value.symmetry === `string` ? { symmetry: mode_value.symmetry } : {}),
        ...(typeof mode_value.mode_type === `string`
          ? { mode_type: mode_value.mode_type }
          : {}),
        degeneracy,
        wavenumber_cm1,
        ir_activity: require_activity(mode_value.ir_activity, `${mode_path}.ir_activity`),
        raman_activity: require_activity(
          mode_value.raman_activity,
          `${mode_path}.raman_activity`,
        ),
        citation_id,
      }
    })
    if (entry_value.frequency_unit !== `cm^-1`) {
      throw new TypeError(`${path}.frequency_unit must be cm^-1`)
    }
    return {
      id,
      name: require_string(entry_value.name, `${path}.name`),
      formula: require_string(entry_value.formula, `${path}.formula`),
      isotopologue: require_string(entry_value.isotopologue, `${path}.isotopologue`),
      phase: require_string(entry_value.phase, `${path}.phase`),
      frequency_unit: `cm^-1`,
      cas_number: require_string(entry_value.cas_number, `${path}.cas_number`),
      inchikey: require_string(entry_value.inchikey, `${path}.inchikey`),
      citations,
      modes,
      ...(entry_value.comparison_url !== undefined && {
        comparison_url: require_string(entry_value.comparison_url, `${path}.comparison_url`),
      }),
    }
  })
}

// Parse an experimental spectrum from either the typed object form or rows of
// [wavenumber_cm1, intensity]. Intensities remain in caller units and are not normalized.
export function parse_experimental_spectrum(value: unknown): ExperimentalSpectrum {
  if (!is_record(value)) throw new TypeError(`Experimental spectrum must be an object`)
  const kind = value.kind
  if (kind !== `ir` && kind !== `raman`)
    throw new TypeError(`Experimental spectrum kind must be ir or raman`)
  const source = require_string(value.source, `experimental.source`)
  let frequencies_cm1: number[]
  let intensities: number[]
  if (Array.isArray(value.data)) {
    frequencies_cm1 = []
    intensities = []
    for (const [row_idx, row] of value.data.entries()) {
      if (!Array.isArray(row) || row.length !== 2)
        throw new TypeError(`experimental.data[${row_idx}] must contain two numbers`)
      frequencies_cm1.push(require_number(row[0], `experimental.data[${row_idx}][0]`))
      intensities.push(require_number(row[1], `experimental.data[${row_idx}][1]`))
    }
  } else {
    if (!Array.isArray(value.frequencies_cm1) || !Array.isArray(value.intensities)) {
      throw new TypeError(
        `Experimental spectrum needs data rows or frequency/intensity arrays`,
      )
    }
    frequencies_cm1 = value.frequencies_cm1.map((item, idx) =>
      require_number(item, `experimental.frequencies_cm1[${idx}]`),
    )
    intensities = value.intensities.map((item, idx) =>
      require_number(item, `experimental.intensities[${idx}]`),
    )
  }
  if (frequencies_cm1.length !== intensities.length || frequencies_cm1.length < 2) {
    throw new TypeError(`Experimental frequency and intensity arrays need equal length >= 2`)
  }
  for (let idx = 1; idx < frequencies_cm1.length; idx++) {
    if (!(frequencies_cm1[idx] > frequencies_cm1[idx - 1])) {
      throw new TypeError(`Experimental frequencies must increase strictly`)
    }
  }
  const temperature =
    value.temperature === undefined
      ? undefined
      : require_number(value.temperature, `experimental.temperature`)
  if (temperature !== undefined && temperature < 0) {
    throw new TypeError(`experimental.temperature must be >= 0`)
  }
  return {
    kind,
    frequencies_cm1,
    intensities,
    source,
    ...(temperature === undefined ? {} : { temperature }),
  }
}

const benchmark_source: ReferenceCitation = {
  id: `vibfreq1295`,
  title: `VIBFREQ1295: A New Database for Vibrational Frequency Calculations`,
  authors: `J. C. Zapata Trujillo and L. K. McKemmish`,
  year: 2023,
  url: `https://doi.org/10.1021/acs.jpca.2c01438`,
  doi: `10.1021/acs.jpca.2c01438`,
  locator: `VIBFREQ1295_Data worksheet; used to identify the original experimental papers, not as a substitute for their citations`,
  access_date: `2026-08-17`,
  redistribution_rationale: `Individual numerical facts are reproduced with attribution; no NIST WebBook table or spectrum is bundled`,
}

const experimental_citation = (
  citation: Omit<ReferenceCitation, `access_date` | `redistribution_rationale` | `url`> & {
    doi: string
  },
): ReferenceCitation => ({
  ...citation,
  url: `https://doi.org/${citation.doi}`,
  access_date: `2026-08-17`,
  redistribution_rationale: `Only a small number of reported band origins and bibliographic facts are reproduced with attribution`,
})

const h2o_bend = experimental_citation({
  id: `h2o-bend-1976`,
  title: `Line positions and intensities in the ν2 band of H2-16O`,
  authors: `C. Camy-Peyret and J. M. Flaud`,
  year: 1976,
  doi: `10.1080/00268977600103261`,
  locator: `Molecular Physics 32, 523–537; ν2 band origin`,
})
const h2o_stretch = experimental_citation({
  id: `h2o-stretch-1956`,
  title: `Rotation-vibration spectra of deuterated water vapor`,
  authors: `W. S. Benedict, N. Gailar, and E. K. Plyler`,
  year: 1956,
  doi: `10.1063/1.1742731`,
  locator: `Journal of Chemical Physics 24, 1139–1165; H2O comparison band origins`,
})
const nh3_umbrella = experimental_citation({
  id: `nh3-umbrella-1981`,
  title: `A simultaneous analysis of transitions between the ground and ν2 inversion-rotation levels of 14NH3`,
  authors: `Š. Urban, V. Špirko, D. Papoušek, J. Kauppinen, S. P. Belov, L. I. Gershtein, and A. F. Krupnov`,
  year: 1981,
  doi: `10.1016/0022-2852(81)90179-X`,
  locator: `Journal of Molecular Spectroscopy 88, 274–292; ν2 inversion-rotation analysis`,
})
const nh3_bend = experimental_citation({
  id: `nh3-bend-2000`,
  title: `Line positions and intensities in the 2ν2/ν4 vibrational system of 14NH3 near 5–7 μm`,
  authors: `C. Cottaz et al.`,
  year: 2000,
  doi: `10.1006/jmsp.2000.8182`,
  locator: `Journal of Molecular Spectroscopy 203, 285–309; ν4 band origins`,
})
const nh3_stretch = experimental_citation({
  id: `nh3-stretch-1999`,
  title: `Positions and intensities in the 2ν4/ν1/ν3 vibrational system of 14NH3 near 3 μm`,
  authors: `I. Kleiner et al.`,
  year: 1999,
  doi: `10.1006/jmsp.1998.7728`,
  locator: `Journal of Molecular Spectroscopy 193, 46–71; ν1 and ν3 band origins`,
})
const ch4_raman = experimental_citation({
  id: `ch4-raman-1960`,
  title: `The Raman spectrum of methane`,
  authors: `M. A. Thomas and H. L. Welsh`,
  year: 1960,
  doi: `10.1139/p60-135`,
  locator: `Canadian Journal of Physics 38, 1291–1303; reported ν1, ν2, and ν3 band origins`,
})
const ch4_nu4 = experimental_citation({
  id: `ch4-nu4-1979`,
  title: `High resolution spectroscopy of the ν4 band of methane`,
  authors: `G. Restelli and F. Cappellani`,
  year: 1979,
  doi: `10.1016/0022-2852(79)90043-2`,
  locator: `Journal of Molecular Spectroscopy 78, 161–169; ν4 fundamental-band analysis`,
})
const co2_bend = experimental_citation({
  id: `co2-bend-1982`,
  title: `New wave-number calibration tables for H2O, CO2, and OCS lines between 500 and 900 cm^-1`,
  authors: `J. Kauppinen, K. Jolma, and V.-M. Horneman`,
  year: 1982,
  doi: `10.1364/AO.21.003332`,
  locator: `Applied Optics 21, 3332; CO2 ν2 lines`,
})
const co2_stretch = experimental_citation({
  id: `co2-stretch-2004`,
  title: `Near infrared spectroscopy of carbon dioxide I. 16O12C16O line positions`,
  authors: `C. E. Miller and L. R. Brown`,
  year: 2004,
  doi: `10.1016/j.jms.2003.11.001`,
  locator: `Journal of Molecular Spectroscopy 228, 329–354; fitted vibrational-state origins`,
})

const vib_mode = (
  mode_id: string,
  label: string,
  symmetry: string,
  mode_type: string,
  degeneracy: number,
  wavenumber_cm1: number,
  ir_activity: SpectralActivity,
  raman_activity: SpectralActivity,
  citation_id: string,
): VibrationalReferenceMode => ({
  mode_id,
  label,
  symmetry,
  mode_type,
  degeneracy,
  wavenumber_cm1,
  ir_activity,
  raman_activity,
  citation_id,
})

export const BUILTIN_VIBRATIONAL_REFERENCES: VibrationalReferenceEntry[] =
  parse_vibrational_reference_catalog([
    {
      id: `h2o-gas-main`,
      name: `Water`,
      formula: `H2O`,
      isotopologue: `1H2-16O`,
      phase: `gas`,
      frequency_unit: `cm^-1`,
      cas_number: `7732-18-5`,
      inchikey: `XLYOFNOQVPJJNP-UHFFFAOYSA-N`,
      comparison_url: `https://webbook.nist.gov/cgi/cbook.cgi?ID=C7732185&Mask=800`,
      modes: [
        vib_mode(`nu2`, `ν2`, `A1`, `bend`, 1, 1595, `active`, `active`, h2o_bend.id),
        vib_mode(
          `nu1`,
          `ν1`,
          `A1`,
          `symmetric stretch`,
          1,
          3657,
          `active`,
          `active`,
          h2o_stretch.id,
        ),
        vib_mode(
          `nu3`,
          `ν3`,
          `B2`,
          `asymmetric stretch`,
          1,
          3756,
          `active`,
          `active`,
          h2o_stretch.id,
        ),
      ],
      citations: [benchmark_source, h2o_bend, h2o_stretch],
    },
    {
      id: `nh3-gas-main`,
      name: `Ammonia`,
      formula: `NH3`,
      isotopologue: `14N-1H3`,
      phase: `gas`,
      frequency_unit: `cm^-1`,
      cas_number: `7664-41-7`,
      inchikey: `QGZKDVFQNNGYKY-UHFFFAOYSA-N`,
      comparison_url: `https://webbook.nist.gov/cgi/cbook.cgi?ID=C7664417&Mask=800`,
      modes: [
        vib_mode(`nu2`, `ν2`, `A1`, `umbrella`, 1, 950, `active`, `active`, nh3_umbrella.id),
        vib_mode(`nu4`, `ν4`, `E`, `bend`, 2, 1627, `active`, `active`, nh3_bend.id),
        vib_mode(
          `nu1`,
          `ν1`,
          `A1`,
          `symmetric stretch`,
          1,
          3337,
          `active`,
          `active`,
          nh3_stretch.id,
        ),
        vib_mode(
          `nu3`,
          `ν3`,
          `E`,
          `asymmetric stretch`,
          2,
          3444,
          `active`,
          `active`,
          nh3_stretch.id,
        ),
      ],
      citations: [benchmark_source, nh3_umbrella, nh3_bend, nh3_stretch],
    },
    {
      id: `ch4-gas-main`,
      name: `Methane`,
      formula: `CH4`,
      isotopologue: `12C-1H4`,
      phase: `gas`,
      frequency_unit: `cm^-1`,
      cas_number: `74-82-8`,
      inchikey: `VNWKTOKETHGBQD-UHFFFAOYSA-N`,
      comparison_url: `https://webbook.nist.gov/cgi/cbook.cgi?ID=C74828&Mask=800`,
      modes: [
        vib_mode(`nu4`, `ν4`, `F2`, `bend`, 3, 1306, `active`, `active`, ch4_nu4.id),
        vib_mode(`nu2`, `ν2`, `E`, `bend`, 2, 1534, `inactive`, `active`, ch4_raman.id),
        vib_mode(
          `nu1`,
          `ν1`,
          `A1`,
          `symmetric stretch`,
          1,
          2917,
          `inactive`,
          `active`,
          ch4_raman.id,
        ),
        vib_mode(
          `nu3`,
          `ν3`,
          `F2`,
          `asymmetric stretch`,
          3,
          3019,
          `active`,
          `active`,
          ch4_raman.id,
        ),
      ],
      citations: [benchmark_source, ch4_raman, ch4_nu4],
    },
    {
      id: `co2-gas-main`,
      name: `Carbon dioxide`,
      formula: `CO2`,
      isotopologue: `12C-16O2`,
      phase: `gas`,
      frequency_unit: `cm^-1`,
      cas_number: `124-38-9`,
      inchikey: `CURLTUGMZLYLDI-UHFFFAOYSA-N`,
      comparison_url: `https://webbook.nist.gov/cgi/cbook.cgi?ID=C124389&Mask=800`,
      modes: [
        vib_mode(`nu2`, `ν2`, `Πu`, `bend`, 2, 667, `active`, `inactive`, co2_bend.id),
        vib_mode(
          `nu1`,
          `ν1`,
          `Σg+`,
          `symmetric stretch`,
          1,
          1333,
          `inactive`,
          `active`,
          co2_stretch.id,
        ),
        vib_mode(
          `nu3`,
          `ν3`,
          `Σu+`,
          `asymmetric stretch`,
          1,
          2349,
          `active`,
          `inactive`,
          co2_stretch.id,
        ),
      ],
      citations: [benchmark_source, co2_bend, co2_stretch],
    },
  ])
