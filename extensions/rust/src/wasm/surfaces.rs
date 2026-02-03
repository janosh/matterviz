//! Surface and slab WASM bindings.

use wasm_bindgen::prelude::*;

use crate::surfaces;
use crate::wasm_types::{JsCrystal, JsMillerIndex, WasmResult};

#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn make_slab(
    structure: JsCrystal,
    miller_index: JsMillerIndex,
    min_slab_size: f64,
    min_vacuum_size: f64,
    center_slab: bool,
    in_unit_planes: bool,
    primitive: bool,
    symprec: f64,
    termination_index: Option<u32>,
) -> WasmResult<JsCrystal> {
    use crate::structure::SlabConfig;

    let result: Result<JsCrystal, String> = (|| {
        let struc = structure.to_structure()?;
        let config = SlabConfig {
            miller_index: miller_index.0,
            min_slab_size,
            min_vacuum_size,
            center_slab,
            in_unit_planes,
            primitive,
            symprec,
            termination_index: termination_index.map(|idx| idx as usize),
        };
        let slab = struc.make_slab(&config).map_err(|err| err.to_string())?;
        Ok(JsCrystal::from_structure(&slab))
    })();
    result.into()
}

#[wasm_bindgen]
#[allow(clippy::too_many_arguments)]
pub fn generate_slabs(
    structure: JsCrystal,
    miller_index: JsMillerIndex,
    min_slab_size: f64,
    min_vacuum_size: f64,
    center_slab: bool,
    in_unit_planes: bool,
    primitive: bool,
    symprec: f64,
) -> WasmResult<Vec<JsCrystal>> {
    use crate::structure::SlabConfig;

    let result: Result<Vec<JsCrystal>, String> = (|| {
        let struc = structure.to_structure()?;
        let config = SlabConfig {
            miller_index: miller_index.0,
            min_slab_size,
            min_vacuum_size,
            center_slab,
            in_unit_planes,
            primitive,
            symprec,
            termination_index: None,
        };
        let slabs = struc
            .generate_slabs(&config)
            .map_err(|err| err.to_string())?;
        Ok(slabs.iter().map(JsCrystal::from_structure).collect())
    })();
    result.into()
}

#[wasm_bindgen]
pub fn surface_enumerate_miller(max_index: i32) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        let indices: Vec<[i32; 3]> = surfaces::enumerate_miller_indices(max_index)
            .into_iter()
            .map(|mi| mi.to_array())
            .collect();
        Ok(serde_json::to_string(&indices).unwrap_or_default())
    })();
    result.into()
}

#[wasm_bindgen]
pub fn surface_miller_to_normal(
    structure: JsCrystal,
    h: i32,
    k: i32,
    l: i32,
) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        let struc = structure.to_structure()?;
        let normal = surfaces::miller_to_normal(&struc.lattice, [h, k, l]);
        Ok(serde_json::to_string(normal.as_slice()).unwrap_or_default())
    })();
    result.into()
}

#[wasm_bindgen]
pub fn surface_enumerate_terminations(
    structure: JsCrystal,
    h: i32,
    k: i32,
    l: i32,
    min_slab: f64,
    min_vacuum: f64,
    symprec: f64,
) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        if !min_slab.is_finite() || min_slab <= 0.0 {
            return Err("min_slab must be positive and finite".to_string());
        }
        if !min_vacuum.is_finite() || min_vacuum <= 0.0 {
            return Err("min_vacuum must be positive and finite".to_string());
        }

        let struc = structure.to_structure()?;
        let miller = surfaces::MillerIndex::new(h, k, l);
        let config = surfaces::SlabConfigExt::new(miller)
            .with_min_slab_size(min_slab)
            .with_min_vacuum(min_vacuum);

        let terminations = surfaces::enumerate_terminations(&struc, miller, &config, symprec)
            .map_err(|err| err.to_string())?;

        let json_terms: Vec<serde_json::Value> = terminations
            .into_iter()
            .map(|term| {
                serde_json::json!({
                    "miller_index": term.miller_index.to_array(),
                    "shift": term.shift,
                    "surface_species": term.surface_species.iter().map(|sp| sp.to_string()).collect::<Vec<_>>(),
                    "surface_density": term.surface_density,
                    "is_polar": term.is_polar,
                    "slab": crate::io::structure_to_pymatgen_json(&term.slab),
                })
            })
            .collect();

        Ok(serde_json::to_string(&json_terms).unwrap_or_default())
    })();
    result.into()
}

#[wasm_bindgen]
pub fn surface_get_surface_atoms(slab: JsCrystal, tolerance: f64) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        if !tolerance.is_finite() || tolerance <= 0.0 {
            return Err("tolerance must be positive and finite".to_string());
        }

        let struc = slab.to_structure()?;
        let atoms = surfaces::get_surface_atoms(&struc, tolerance);
        Ok(serde_json::to_string(&atoms).unwrap_or_default())
    })();
    result.into()
}

#[wasm_bindgen]
pub fn surface_area(slab: JsCrystal) -> WasmResult<f64> {
    let result: Result<f64, String> = (|| {
        let struc = slab.to_structure()?;
        Ok(surfaces::surface_area(&struc))
    })();
    result.into()
}

#[wasm_bindgen]
pub fn surface_calculate_energy(
    slab_energy: f64,
    bulk_energy_per_atom: f64,
    n_atoms: u32,
    surface_area: f64,
) -> f64 {
    if surface_area == 0.0 || !surface_area.is_finite() {
        return f64::NAN;
    }
    surfaces::calculate_surface_energy(
        slab_energy,
        bulk_energy_per_atom,
        n_atoms as usize,
        surface_area,
    )
}

#[wasm_bindgen]
pub fn surface_find_adsorption_sites(
    slab: JsCrystal,
    height: f64,
    site_types_json: &str,
    neighbor_cutoff: Option<f64>,
    surface_tolerance: Option<f64>,
) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        if !height.is_finite() || height < 0.0 {
            return Err("height must be non-negative and finite".to_string());
        }
        if let Some(cutoff) = neighbor_cutoff {
            if !cutoff.is_finite() || cutoff <= 0.0 {
                return Err("neighbor_cutoff must be positive and finite".to_string());
            }
        }

        let struc = slab.to_structure()?;
        let site_types: Option<Vec<surfaces::AdsorptionSiteType>> = if site_types_json.is_empty() {
            None
        } else {
            let strings: Vec<String> = serde_json::from_str(site_types_json)
                .map_err(|err| format!("Invalid site types JSON: {err}"))?;
            let parsed: Vec<surfaces::AdsorptionSiteType> = strings
                .iter()
                .filter_map(|s| surfaces::AdsorptionSiteType::parse(s))
                .collect();
            if parsed.is_empty() {
                None
            } else {
                Some(parsed)
            }
        };
        let sites = surfaces::find_adsorption_sites(
            &struc,
            height,
            site_types.as_deref(),
            neighbor_cutoff,
            surface_tolerance,
        )
        .map_err(|err| err.to_string())?;
        let json_sites: Vec<serde_json::Value> = sites
            .into_iter()
            .map(|site| {
                serde_json::json!({
                    "site_type": site.site_type,
                    "position": site.position.as_slice(),
                    "cart_position": site.cart_position.as_slice(),
                    "height": site.height,
                    "coordinating_atoms": site.coordinating_atoms,
                })
            })
            .collect();
        Ok(serde_json::to_string(&json_sites).unwrap_or_default())
    })();
    result.into()
}

#[wasm_bindgen]
pub fn surface_compute_wulff(
    structure: JsCrystal,
    surface_energies_json: &str,
) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        let struc = structure.to_structure()?;
        let raw: Vec<(Vec<i32>, f64)> = serde_json::from_str(surface_energies_json)
            .map_err(|err| format!("Invalid surface energies JSON: {err}"))?;
        let mut surface_energies: Vec<(surfaces::MillerIndex, f64)> = Vec::with_capacity(raw.len());
        for (hkl, energy) in raw {
            if hkl.len() < 3 {
                return Err(format!(
                    "Invalid Miller index: expected 3 components, got {}",
                    hkl.len()
                ));
            }
            surface_energies.push((surfaces::MillerIndex::new(hkl[0], hkl[1], hkl[2]), energy));
        }
        let wulff = surfaces::compute_wulff_shape(&struc.lattice, &surface_energies)
            .map_err(|err| err.to_string())?;
        let facets_json: Vec<serde_json::Value> = wulff
            .facets
            .iter()
            .map(|facet| {
                serde_json::json!({
                    "miller_index": facet.miller_index.to_array(),
                    "surface_energy": facet.surface_energy,
                    "normal": facet.normal.as_slice(),
                    "area_fraction": facet.area_fraction,
                })
            })
            .collect();
        let json = serde_json::json!({
            "facets": facets_json,
            "total_surface_area": wulff.total_surface_area,
            "volume": wulff.volume,
            "sphericity": wulff.sphericity,
        });
        Ok(json.to_string())
    })();
    result.into()
}
