//! Defect generation functions.
//!
//! This module provides functions for creating and analyzing point defects
//! in crystalline structures.

use nalgebra::Vector3;
use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use pyo3::types::{PyDict, PyList};

use crate::defects;
use crate::distortions;
use crate::io::structure_to_pymatgen_json;
use crate::species::Species;

use super::helpers::{StructureJson, defect_result_to_pydict, json_to_pydict, parse_struct};

/// Convert interstitial sites to Python dicts.
fn interstitial_sites_to_dicts(
    py: Python<'_>,
    sites: Vec<defects::VoronoiInterstitial>,
) -> PyResult<Vec<Py<PyDict>>> {
    sites
        .into_iter()
        .map(|site| {
            let dict = PyDict::new(py);
            dict.set_item("frac_coords", site.frac_coords.as_slice())?;
            dict.set_item("cart_coords", site.cart_coords.as_slice())?;
            dict.set_item("min_distance", site.min_distance)?;
            dict.set_item("coordination", site.coordination)?;
            dict.set_item("site_type", site.site_type.as_str())?;
            Ok(dict.unbind())
        })
        .collect()
}

/// Convert distortion result to Python dict.
fn distortion_to_pydict(
    py: Python<'_>,
    result: &crate::distortions::DistortionResult,
) -> PyResult<Py<PyDict>> {
    let dict = PyDict::new(py);
    let struct_json = structure_to_pymatgen_json(&result.structure);
    dict.set_item("structure", json_to_pydict(py, &struct_json)?)?;
    dict.set_item("distortion_type", &result.distortion_type)?;
    dict.set_item("distortion_factor", result.distortion_factor)?;
    dict.set_item("center_site_idx", result.center_site_idx)?;
    Ok(dict.unbind())
}

/// Create a vacancy by removing an atom at the specified site index.
#[pyfunction]
fn create_vacancy(
    py: Python<'_>,
    structure: StructureJson,
    site_idx: usize,
) -> PyResult<Py<PyDict>> {
    let struc = parse_struct(&structure)?;
    let result = defects::create_vacancy(&struc, site_idx)
        .map_err(|err| PyValueError::new_err(err.to_string()))?;
    defect_result_to_pydict(py, &result)
}

/// Create a substitutional defect by replacing the species at a site.
#[pyfunction]
fn create_substitution(
    py: Python<'_>,
    structure: StructureJson,
    site_idx: usize,
    new_species: &str,
) -> PyResult<Py<PyDict>> {
    let struc = parse_struct(&structure)?;
    let species = Species::from_string(new_species)
        .ok_or_else(|| PyValueError::new_err(format!("Invalid species: {new_species}")))?;
    let result = defects::create_substitution(&struc, site_idx, species)
        .map_err(|err| PyValueError::new_err(err.to_string()))?;
    defect_result_to_pydict(py, &result)
}

/// Create an interstitial by adding an atom at a fractional position.
#[pyfunction]
fn create_interstitial(
    py: Python<'_>,
    structure: StructureJson,
    position: [f64; 3],
    species: &str,
) -> PyResult<Py<PyDict>> {
    let struc = parse_struct(&structure)?;
    let new_species = Species::from_string(species)
        .ok_or_else(|| PyValueError::new_err(format!("Invalid species: {species}")))?;
    let frac_pos = Vector3::new(position[0], position[1], position[2]);
    let result = defects::create_interstitial(&struc, frac_pos, new_species)
        .map_err(|err| PyValueError::new_err(err.to_string()))?;
    defect_result_to_pydict(py, &result)
}

/// Create an antisite pair by swapping species at two sites.
/// Returns structure dict (no defect metadata since antisites modify two sites).
#[pyfunction]
fn create_antisite(
    py: Python<'_>,
    structure: StructureJson,
    site_a_idx: usize,
    site_b_idx: usize,
) -> PyResult<Py<PyDict>> {
    let struc = parse_struct(&structure)?;
    let result = defects::create_antisite_pair(&struc, site_a_idx, site_b_idx)
        .map_err(|err| PyValueError::new_err(err.to_string()))?;

    // Wrap in consistent format with other defect functions
    let dict = PyDict::new(py);
    let struct_json = structure_to_pymatgen_json(&result);
    dict.set_item("structure", json_to_pydict(py, &struct_json)?)?;
    dict.set_item("defect_type", "antisite")?;
    dict.set_item("site_idx", site_a_idx)?; // Primary site
    Ok(dict.unbind())
}

/// Find potential interstitial sites using Voronoi tessellation.
#[pyfunction]
#[pyo3(signature = (structure, min_dist = None, symprec = 0.01))]
fn find_interstitial_sites(
    py: Python<'_>,
    structure: StructureJson,
    min_dist: Option<f64>,
    symprec: f64,
) -> PyResult<Vec<Py<PyDict>>> {
    if !symprec.is_finite() || symprec <= 0.0 {
        return Err(PyValueError::new_err(format!(
            "symprec must be positive and finite, got {symprec}"
        )));
    }
    let struc = parse_struct(&structure)?;
    interstitial_sites_to_dicts(
        py,
        defects::find_voronoi_interstitials(&struc, min_dist, symprec),
    )
}

/// Find an optimal supercell matrix for dilute defect calculations.
#[pyfunction]
#[pyo3(signature = (structure, min_image_dist = 10.0, max_atoms = 200, cubic = false))]
fn find_supercell(
    structure: StructureJson,
    min_image_dist: f64,
    max_atoms: usize,
    cubic: bool,
) -> PyResult<[[i32; 3]; 3]> {
    let struc = parse_struct(&structure)?;
    if !min_image_dist.is_finite() || min_image_dist <= 0.0 {
        return Err(PyValueError::new_err(
            "min_image_dist must be positive and finite",
        ));
    }
    if max_atoms == 0 {
        return Err(PyValueError::new_err("max_atoms must be greater than 0"));
    }

    let config = defects::DefectSupercellConfig {
        min_distance: min_image_dist,
        max_atoms,
        cubic_preference: if cubic { 1.0 } else { 0.0 },
    };

    defects::find_defect_supercell(&struc, &config)
        .map_err(|err| PyValueError::new_err(err.to_string()))
}

/// Classify an interstitial site based on its coordination number.
#[pyfunction]
fn classify_site(coordination: usize) -> String {
    defects::classify_interstitial_site(coordination)
        .as_str()
        .to_string()
}

/// Distort bonds around a defect site by specified factors.
#[pyfunction]
#[pyo3(signature = (structure, center_site_idx, distortion_factors, num_neighbors = None, cutoff = 5.0))]
fn distort_bonds(
    py: Python<'_>,
    structure: StructureJson,
    center_site_idx: usize,
    distortion_factors: Vec<f64>,
    num_neighbors: Option<usize>,
    cutoff: f64,
) -> PyResult<Py<PyList>> {
    let struc = parse_struct(&structure)?;
    let results = distortions::distort_bonds(
        &struc,
        center_site_idx,
        &distortion_factors,
        num_neighbors,
        cutoff,
    )
    .map_err(|err| PyValueError::new_err(err.to_string()))?;

    let list = PyList::empty(py);
    for result in results {
        list.append(distortion_to_pydict(py, &result)?)?;
    }
    Ok(list.unbind())
}

/// Create a dimer by moving two atoms closer together.
#[pyfunction]
fn create_dimer(
    py: Python<'_>,
    structure: StructureJson,
    site_a_idx: usize,
    site_b_idx: usize,
    target_distance: f64,
) -> PyResult<Py<PyDict>> {
    if !target_distance.is_finite() || target_distance <= 0.0 {
        return Err(PyValueError::new_err(
            "target_distance must be positive and finite",
        ));
    }
    let struc = parse_struct(&structure)?;
    let result = distortions::create_dimer(&struc, site_a_idx, site_b_idx, target_distance)
        .map_err(|err| PyValueError::new_err(err.to_string()))?;
    distortion_to_pydict(py, &result)
}

/// Apply Monte Carlo rattling to all atoms in a structure.
#[pyfunction]
#[pyo3(signature = (structure, stdev, seed, min_distance = 0.5, max_attempts = 100))]
fn rattle(
    py: Python<'_>,
    structure: StructureJson,
    stdev: f64,
    seed: u64,
    min_distance: f64,
    max_attempts: usize,
) -> PyResult<Py<PyDict>> {
    if !stdev.is_finite() || stdev < 0.0 {
        return Err(PyValueError::new_err(
            "stdev must be non-negative and finite",
        ));
    }
    if !min_distance.is_finite() || min_distance < 0.0 {
        return Err(PyValueError::new_err(
            "min_distance must be non-negative and finite",
        ));
    }
    if max_attempts == 0 {
        return Err(PyValueError::new_err("max_attempts must be greater than 0"));
    }
    let struc = parse_struct(&structure)?;
    let result = distortions::rattle_structure(&struc, stdev, seed, min_distance, max_attempts)
        .map_err(|err| PyValueError::new_err(err.to_string()))?;
    distortion_to_pydict(py, &result)
}

/// Apply local rattling with distance-dependent amplitude decay.
#[pyfunction]
fn local_rattle(
    py: Python<'_>,
    structure: StructureJson,
    center_site_idx: usize,
    max_amplitude: f64,
    decay_radius: f64,
    seed: u64,
) -> PyResult<Py<PyDict>> {
    if !max_amplitude.is_finite() || max_amplitude < 0.0 {
        return Err(PyValueError::new_err(
            "max_amplitude must be non-negative and finite",
        ));
    }
    if !decay_radius.is_finite() || decay_radius <= 0.0 {
        return Err(PyValueError::new_err(
            "decay_radius must be positive and finite",
        ));
    }
    let struc = parse_struct(&structure)?;
    let result =
        distortions::local_rattle(&struc, center_site_idx, max_amplitude, decay_radius, seed)
            .map_err(|err| PyValueError::new_err(err.to_string()))?;
    distortion_to_pydict(py, &result)
}

/// Guess reasonable charge states for a defect based on element oxidation states.
///
/// Args:
///     defect_type: Type of defect (currently unused, for future heuristics)
///     species: Element symbol to look up oxidation states for
///
/// Returns:
///     List of possible charge states based on common oxidation states
#[pyfunction]
#[pyo3(signature = (defect_type, species = None))]
fn guess_charge_states(defect_type: &str, species: Option<&str>) -> Vec<i32> {
    // TODO: Use defect_type to adjust heuristics (e.g., vacancies vs interstitials)
    let _ = defect_type;

    // Basic heuristic: use common oxidation states of the species
    if let Some(sp) = species {
        if let Some(elem) = crate::element::Element::from_symbol(sp) {
            return elem
                .common_oxidation_states()
                .iter()
                .map(|&s| s as i32)
                .collect();
        }
    }
    vec![-2, -1, 0, 1, 2]
}

/// Generate all point defects for a structure.
#[pyfunction]
#[pyo3(signature = (structure, extrinsic = None, symprec = 0.01, interstitial_min_dist = 1.0))]
fn generate_all(
    py: Python<'_>,
    structure: StructureJson,
    extrinsic: Option<Vec<String>>,
    symprec: f64,
    interstitial_min_dist: f64,
) -> PyResult<Py<PyDict>> {
    let struc = parse_struct(&structure)?;

    let config = defects::DefectsGeneratorConfig {
        extrinsic: extrinsic.unwrap_or_default(),
        symprec,
        interstitial_min_dist: Some(interstitial_min_dist),
        ..Default::default()
    };

    let result = defects::generate_all_defects(&struc, &config)
        .map_err(|err| PyValueError::new_err(err.to_string()))?;

    let output = PyDict::new(py);

    // Helper to convert DefectEntry to dict
    fn entry_to_dict(py: Python<'_>, entry: &defects::DefectEntry) -> PyResult<Py<PyDict>> {
        let dict = PyDict::new(py);
        dict.set_item("name", &entry.name)?;
        dict.set_item("defect_type", entry.defect_type.as_str())?;
        if let Some(ref species) = entry.species {
            dict.set_item("species", species)?;
        }
        if let Some(ref original_species) = entry.original_species {
            dict.set_item("original_species", original_species)?;
        }
        dict.set_item("site_idx", entry.site_idx)?;
        dict.set_item("frac_coords", entry.frac_coords.as_slice())?;
        dict.set_item("equivalent_sites", entry.equivalent_sites)?;
        Ok(dict.unbind())
    }

    // Vacancies
    let vacancies = PyList::empty(py);
    for vac in &result.vacancies {
        vacancies.append(entry_to_dict(py, vac)?)?;
    }
    output.set_item("vacancies", vacancies)?;

    // Substitutions
    let substitutions = PyList::empty(py);
    for sub in &result.substitutions {
        substitutions.append(entry_to_dict(py, sub)?)?;
    }
    output.set_item("substitutions", substitutions)?;

    // Interstitials
    let interstitials = PyList::empty(py);
    for inter in &result.interstitials {
        interstitials.append(entry_to_dict(py, inter)?)?;
    }
    output.set_item("interstitials", interstitials)?;

    // Antisites
    let antisites = PyList::empty(py);
    for anti in &result.antisites {
        antisites.append(entry_to_dict(py, anti)?)?;
    }
    output.set_item("antisites", antisites)?;

    Ok(output.unbind())
}

/// Register the defects submodule.
pub fn register(parent: &Bound<'_, PyModule>) -> PyResult<()> {
    let submod = PyModule::new(parent.py(), "defects")?;
    submod.add_function(wrap_pyfunction!(create_vacancy, &submod)?)?;
    submod.add_function(wrap_pyfunction!(create_substitution, &submod)?)?;
    submod.add_function(wrap_pyfunction!(create_interstitial, &submod)?)?;
    submod.add_function(wrap_pyfunction!(create_antisite, &submod)?)?;
    submod.add_function(wrap_pyfunction!(find_interstitial_sites, &submod)?)?;
    submod.add_function(wrap_pyfunction!(find_supercell, &submod)?)?;
    submod.add_function(wrap_pyfunction!(classify_site, &submod)?)?;
    submod.add_function(wrap_pyfunction!(distort_bonds, &submod)?)?;
    submod.add_function(wrap_pyfunction!(create_dimer, &submod)?)?;
    submod.add_function(wrap_pyfunction!(rattle, &submod)?)?;
    submod.add_function(wrap_pyfunction!(local_rattle, &submod)?)?;
    submod.add_function(wrap_pyfunction!(guess_charge_states, &submod)?)?;
    submod.add_function(wrap_pyfunction!(generate_all, &submod)?)?;
    parent.add_submodule(&submod)?;
    Ok(())
}
