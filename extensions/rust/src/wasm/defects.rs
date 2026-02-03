//! Point defects and distortions WASM bindings.

use wasm_bindgen::prelude::*;

use crate::defects;
use crate::distortions;
use crate::species::Species;
use crate::wasm_types::{JsCrystal, WasmResult};

#[wasm_bindgen]
pub fn defect_create_vacancy(structure: JsCrystal, site_idx: u32) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        let struc = structure.to_structure()?;
        let defect_result =
            defects::create_vacancy(&struc, site_idx as usize).map_err(|err| err.to_string())?;
        let json = serde_json::json!({
            "structure": serde_json::to_value(&defect_result.structure).unwrap_or_default(),
            "defect_type": defect_result.defect.defect_type.as_str(),
            "site_idx": defect_result.defect.site_idx,
            "position": defect_result.defect.position.as_slice(),
            "original_species": defect_result.defect.original_species.map(|s| s.to_string()),
        });
        Ok(json.to_string())
    })();
    result.into()
}

#[wasm_bindgen]
pub fn defect_create_substitution(
    structure: JsCrystal,
    site_idx: u32,
    new_species: &str,
) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        let struc = structure.to_structure()?;
        let species = Species::from_string(new_species)
            .ok_or_else(|| format!("Invalid species: {new_species}"))?;
        let defect_result = defects::create_substitution(&struc, site_idx as usize, species)
            .map_err(|err| err.to_string())?;
        let json = serde_json::json!({
            "structure": serde_json::to_value(&defect_result.structure).unwrap_or_default(),
            "defect_type": defect_result.defect.defect_type.as_str(),
            "site_idx": defect_result.defect.site_idx,
            "position": defect_result.defect.position.as_slice(),
            "species": defect_result.defect.species.map(|s| s.to_string()),
            "original_species": defect_result.defect.original_species.map(|s| s.to_string()),
        });
        Ok(json.to_string())
    })();
    result.into()
}

#[wasm_bindgen]
pub fn defect_create_interstitial(
    structure: JsCrystal,
    position: Vec<f64>,
    species: &str,
) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        if position.len() != 3 {
            return Err("Position must have 3 elements".to_string());
        }
        let struc = structure.to_structure()?;
        let new_species =
            Species::from_string(species).ok_or_else(|| format!("Invalid species: {species}"))?;
        let frac_pos = nalgebra::Vector3::new(position[0], position[1], position[2]);
        let defect_result = defects::create_interstitial(&struc, frac_pos, new_species)
            .map_err(|err| err.to_string())?;
        let json = serde_json::json!({
            "structure": serde_json::to_value(&defect_result.structure).unwrap_or_default(),
            "defect_type": defect_result.defect.defect_type.as_str(),
            "position": defect_result.defect.position.as_slice(),
            "species": defect_result.defect.species.map(|s| s.to_string()),
        });
        Ok(json.to_string())
    })();
    result.into()
}

#[wasm_bindgen]
pub fn defect_create_antisite(
    structure: JsCrystal,
    site_a_idx: u32,
    site_b_idx: u32,
) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        let struc = structure.to_structure()?;
        let n_sites = struc.num_sites();
        if site_a_idx as usize >= n_sites || site_b_idx as usize >= n_sites {
            return Err(format!(
                "Site indices out of bounds for structure with {} sites",
                n_sites
            ));
        }
        let species_a = struc.species()[site_a_idx as usize];
        let species_b = struc.species()[site_b_idx as usize];
        let swapped =
            defects::create_antisite_pair(&struc, site_a_idx as usize, site_b_idx as usize)
                .map_err(|err| err.to_string())?;
        let json = serde_json::json!({
            "structure": serde_json::to_value(&swapped).unwrap_or_default(),
            "defect_type": "antisite",
            "site_a_idx": site_a_idx,
            "site_b_idx": site_b_idx,
            "species_a_original": species_a.to_string(),
            "species_b_original": species_b.to_string(),
        });
        Ok(json.to_string())
    })();
    result.into()
}

#[wasm_bindgen]
pub fn defect_find_interstitial_sites(
    structure: JsCrystal,
    min_dist: f64,
    symprec: f64,
) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        if !min_dist.is_finite() || min_dist <= 0.0 {
            return Err("min_dist must be positive and finite".to_string());
        }

        let struc = structure.to_structure()?;
        let sites = defects::find_voronoi_interstitials(&struc, Some(min_dist), symprec);
        let json_sites: Vec<serde_json::Value> = sites
            .into_iter()
            .map(|site| {
                serde_json::json!({
                    "frac_coords": site.frac_coords.as_slice(),
                    "cart_coords": site.cart_coords.as_slice(),
                    "min_distance": site.min_distance,
                    "coordination": site.coordination,
                    "site_type": site.site_type.as_str(),
                })
            })
            .collect();
        Ok(serde_json::to_string(&json_sites).unwrap_or_default())
    })();
    result.into()
}

#[wasm_bindgen]
pub fn defect_find_supercell(
    structure: JsCrystal,
    min_image_dist: f64,
    max_atoms: u32,
    cubic_preference: f64,
) -> WasmResult<Vec<i32>> {
    let result: Result<Vec<i32>, String> = (|| {
        if !min_image_dist.is_finite() || min_image_dist <= 0.0 {
            return Err("min_image_dist must be positive and finite".to_string());
        }
        if max_atoms == 0 {
            return Err("max_atoms must be greater than 0".to_string());
        }

        let struc = structure.to_structure()?;
        let config = defects::DefectSupercellConfig {
            min_distance: min_image_dist,
            max_atoms: max_atoms as usize,
            cubic_preference,
        };
        let matrix =
            defects::find_defect_supercell(&struc, &config).map_err(|err| err.to_string())?;
        Ok(vec![
            matrix[0][0],
            matrix[0][1],
            matrix[0][2],
            matrix[1][0],
            matrix[1][1],
            matrix[1][2],
            matrix[2][0],
            matrix[2][1],
            matrix[2][2],
        ])
    })();
    result.into()
}

#[wasm_bindgen]
pub fn defect_classify_site(coordination: u32) -> String {
    defects::classify_interstitial_site(coordination as usize)
        .as_str()
        .to_string()
}

#[wasm_bindgen]
pub fn defect_generate_name(
    defect_type: &str,
    species: Option<String>,
    original_species: Option<String>,
    wyckoff: Option<String>,
    site_type: Option<String>,
) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        use crate::defects::{DefectType, PointDefect};
        use nalgebra::Vector3;

        let dtype = match defect_type.to_lowercase().as_str() {
            "vacancy" => DefectType::Vacancy,
            "interstitial" => DefectType::Interstitial,
            "substitution" => DefectType::Substitution,
            "antisite" => DefectType::Antisite,
            other => return Err(format!("Unknown defect type: {other}")),
        };

        let species_parsed = species.as_ref().and_then(|s| Species::from_string(s));
        let original_parsed = original_species
            .as_ref()
            .and_then(|s| Species::from_string(s));

        let defect = PointDefect {
            defect_type: dtype,
            site_idx: None,
            position: Vector3::zeros(),
            species: species_parsed,
            original_species: original_parsed,
            charge: 0,
        };

        Ok(defect.name(wyckoff.as_deref(), site_type.as_deref()))
    })();
    result.into()
}

#[wasm_bindgen]
pub fn defect_guess_charge_states(
    defect_type: &str,
    removed_species: Option<String>,
    added_species: Option<String>,
    original_species: Option<String>,
    max_charge: i32,
) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        use crate::defects::DefectType;
        use crate::oxidation::guess_defect_charge_states;

        let dtype = match defect_type.to_lowercase().as_str() {
            "vacancy" => DefectType::Vacancy,
            "interstitial" => DefectType::Interstitial,
            "substitution" => DefectType::Substitution,
            "antisite" => DefectType::Antisite,
            other => return Err(format!("Unknown defect type: {other}")),
        };

        let guesses = guess_defect_charge_states(
            dtype,
            removed_species.as_deref(),
            added_species.as_deref(),
            original_species.as_deref(),
            max_charge,
        );

        let json_guesses: Vec<serde_json::Value> = guesses
            .into_iter()
            .map(|guess| {
                serde_json::json!({
                    "charge": guess.charge,
                    "probability": guess.probability,
                    "reasoning": guess.reasoning,
                })
            })
            .collect();
        Ok(serde_json::to_string(&json_guesses).unwrap_or_default())
    })();
    result.into()
}

#[wasm_bindgen]
pub fn defect_get_wyckoff_labels(structure: JsCrystal, symprec: f64) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        let struc = structure.to_structure()?;
        let wyckoffs = struc
            .get_wyckoff_sites(symprec)
            .map_err(|err| err.to_string())?;
        let json_sites: Vec<serde_json::Value> = wyckoffs
            .into_iter()
            .map(|wyk| {
                serde_json::json!({
                    "label": wyk.label,
                    "multiplicity": wyk.multiplicity,
                    "site_symmetry": wyk.site_symmetry,
                })
            })
            .collect();
        Ok(serde_json::to_string(&json_sites).unwrap_or_default())
    })();
    result.into()
}

#[wasm_bindgen]
pub fn defect_distort_bonds(
    structure: JsCrystal,
    center_site_idx: u32,
    distortion_factors: Vec<f64>,
    num_neighbors: Option<u32>,
    cutoff: f64,
) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        if !cutoff.is_finite() || cutoff <= 0.0 {
            return Err("cutoff must be positive and finite".to_string());
        }

        let struc = structure.to_structure()?;
        let results = distortions::distort_bonds(
            &struc,
            center_site_idx as usize,
            &distortion_factors,
            num_neighbors.map(|n| n as usize),
            cutoff,
        )
        .map_err(|err| err.to_string())?;

        let json_results: Vec<serde_json::Value> = results
            .into_iter()
            .map(|res| {
                serde_json::json!({
                    "structure": serde_json::to_value(&res.structure).unwrap_or_default(),
                    "distortion_type": res.distortion_type,
                    "distortion_factor": res.distortion_factor,
                    "center_site_idx": res.center_site_idx,
                })
            })
            .collect();
        Ok(serde_json::to_string(&json_results).unwrap_or_default())
    })();
    result.into()
}

#[wasm_bindgen]
pub fn defect_create_dimer(
    structure: JsCrystal,
    site_a_idx: u32,
    site_b_idx: u32,
    target_distance: f64,
) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        if !target_distance.is_finite() || target_distance <= 0.0 {
            return Err("target_distance must be positive and finite".to_string());
        }

        let struc = structure.to_structure()?;
        let res = distortions::create_dimer(
            &struc,
            site_a_idx as usize,
            site_b_idx as usize,
            target_distance,
        )
        .map_err(|err| err.to_string())?;
        let json = serde_json::json!({
            "structure": serde_json::to_value(&res.structure).unwrap_or_default(),
            "distortion_type": res.distortion_type,
            "distortion_factor": res.distortion_factor,
        });
        Ok(json.to_string())
    })();
    result.into()
}

#[wasm_bindgen]
pub fn defect_rattle(
    structure: JsCrystal,
    stdev: f64,
    seed: u32,
    min_distance: f64,
    max_attempts: u32,
) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        if !stdev.is_finite() || stdev < 0.0 {
            return Err("stdev must be non-negative and finite".to_string());
        }
        if !min_distance.is_finite() || min_distance < 0.0 {
            return Err("min_distance must be non-negative and finite".to_string());
        }
        if max_attempts == 0 {
            return Err("max_attempts must be greater than 0".to_string());
        }

        let struc = structure.to_structure()?;
        let res = distortions::rattle_structure(
            &struc,
            stdev,
            seed as u64,
            min_distance,
            max_attempts as usize,
        )
        .map_err(|err| err.to_string())?;
        let json = serde_json::json!({
            "structure": serde_json::to_value(&res.structure).unwrap_or_default(),
            "distortion_type": res.distortion_type,
            "distortion_factor": res.distortion_factor,
        });
        Ok(json.to_string())
    })();
    result.into()
}

#[wasm_bindgen]
pub fn defect_local_rattle(
    structure: JsCrystal,
    center_site_idx: u32,
    max_amplitude: f64,
    decay_radius: f64,
    seed: u32,
) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        if !max_amplitude.is_finite() || max_amplitude < 0.0 {
            return Err("max_amplitude must be non-negative and finite".to_string());
        }
        if !decay_radius.is_finite() || decay_radius <= 0.0 {
            return Err("decay_radius must be positive and finite".to_string());
        }

        let struc = structure.to_structure()?;
        let res = distortions::local_rattle(
            &struc,
            center_site_idx as usize,
            max_amplitude,
            decay_radius,
            seed as u64,
        )
        .map_err(|err| err.to_string())?;
        let json = serde_json::json!({
            "structure": serde_json::to_value(&res.structure).unwrap_or_default(),
            "distortion_type": res.distortion_type,
            "distortion_factor": res.distortion_factor,
            "center_site_idx": res.center_site_idx,
        });
        Ok(json.to_string())
    })();
    result.into()
}

#[wasm_bindgen]
pub fn defect_generate_all(
    structure: JsCrystal,
    extrinsic_json: &str,
    include_vacancies: bool,
    include_substitutions: bool,
    include_interstitials: bool,
    include_antisites: bool,
    supercell_min_dist: f64,
    supercell_max_atoms: u32,
    interstitial_min_dist: Option<f64>,
    symprec: f64,
    max_charge: i32,
) -> WasmResult<String> {
    let result: Result<String, String> = (|| {
        let struc = structure.to_structure()?;
        let extrinsic: Vec<String> = if extrinsic_json.is_empty() {
            Vec::new()
        } else {
            serde_json::from_str(extrinsic_json)
                .map_err(|err| format!("Invalid extrinsic_json: {err}"))?
        };

        let config = crate::defects::DefectsGeneratorConfig {
            extrinsic,
            include_vacancies,
            include_substitutions,
            include_interstitials,
            include_antisites,
            supercell_min_dist,
            supercell_max_atoms: supercell_max_atoms as usize,
            interstitial_min_dist,
            symprec,
            max_charge,
        };

        let result =
            crate::defects::generate_all_defects(&struc, &config).map_err(|err| err.to_string())?;

        fn entry_to_json(entry: &crate::defects::DefectEntry) -> serde_json::Value {
            serde_json::json!({
                "name": entry.name,
                "defect_type": format!("{:?}", entry.defect_type),
                "site_idx": entry.site_idx,
                "frac_coords": entry.frac_coords.as_slice(),
                "species": entry.species,
                "original_species": entry.original_species,
                "wyckoff": entry.wyckoff,
                "site_symmetry": entry.site_symmetry,
                "equivalent_sites": entry.equivalent_sites,
                "charge_states": entry.charge_states.iter().map(|cs| {
                    serde_json::json!({
                        "charge": cs.charge,
                        "probability": cs.probability,
                        "reasoning": cs.reasoning,
                    })
                }).collect::<Vec<_>>(),
            })
        }

        let json = serde_json::json!({
            "supercell_matrix": result.supercell_matrix,
            "vacancies": result.vacancies.iter().map(entry_to_json).collect::<Vec<_>>(),
            "substitutions": result.substitutions.iter().map(entry_to_json).collect::<Vec<_>>(),
            "interstitials": result.interstitials.iter().map(entry_to_json).collect::<Vec<_>>(),
            "antisites": result.antisites.iter().map(entry_to_json).collect::<Vec<_>>(),
            "spacegroup": result.spacegroup,
            "n_defects": result.n_defects,
        });
        Ok(json.to_string())
    })();
    result.into()
}
