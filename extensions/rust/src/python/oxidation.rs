//! Oxidation state analysis functions.

use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use pyo3::types::PyDict;
use pyo3_stub_gen::derive::gen_stub_pyfunction;

use crate::composition::Composition;
use crate::oxidation;
use crate::structure::Structure;

use super::helpers::{StructureJson, parse_struct, structure_to_pydict};

/// Extract elements and their amounts from a structure's composition.
#[inline]
fn get_elements_and_amounts(struc: &Structure) -> (Vec<crate::element::Element>, Vec<f64>) {
    let comp = struc.composition();
    let elements: Vec<crate::element::Element> = comp.elements();
    let amounts: Vec<f64> = elements.iter().map(|e| comp.get(*e)).collect();
    (elements, amounts)
}

/// Extract elements and amounts from a composition.
#[inline]
fn get_elements_and_amounts_from_comp(
    comp: &Composition,
) -> (Vec<crate::element::Element>, Vec<f64>) {
    let elements: Vec<crate::element::Element> = comp.elements();
    let amounts: Vec<f64> = elements.iter().map(|e| comp.get(*e)).collect();
    (elements, amounts)
}

/// Guess oxidation states for a structure or formula.
/// Accepts either a structure JSON string or a formula string like "Fe2O3".
#[gen_stub_pyfunction]
#[pyfunction]
#[pyo3(signature = (structure_or_formula, all_states = false))]
fn oxi_state_guesses(
    py: Python<'_>,
    structure_or_formula: &str,
    all_states: bool,
) -> PyResult<Vec<Py<PyDict>>> {
    // Trim leading whitespace before detecting input type
    let input = structure_or_formula.trim_start();
    // Try to parse as structure first
    let (elements, amounts) = if input.starts_with('{') {
        // Looks like JSON - parse as structure
        let struc = parse_struct(&StructureJson(input.to_string()))?;
        get_elements_and_amounts(&struc)
    } else {
        // Try as formula string
        let comp = Composition::from_formula(input)
            .map_err(|e| PyValueError::new_err(format!("Invalid formula: {e}")))?;
        get_elements_and_amounts_from_comp(&comp)
    };

    let guesses = oxidation::oxi_state_guesses(&elements, &amounts, 0, None, all_states, None);

    guesses
        .into_iter()
        .map(|guess| {
            let dict = PyDict::new(py);
            let states_dict = PyDict::new(py);
            for (elem, oxi) in &guess.oxidation_states {
                states_dict.set_item(elem, *oxi)?;
            }
            dict.set_item("oxidation_states", states_dict)?;
            dict.set_item("probability", guess.probability)?;
            Ok(dict.unbind())
        })
        .collect()
}

/// Add oxidation states from guesses to a structure.
#[gen_stub_pyfunction]
#[pyfunction]
fn add_charges_from_oxi_state_guesses(
    py: Python<'_>,
    structure: StructureJson,
) -> PyResult<Py<PyDict>> {
    let struc = parse_struct(&structure)?;
    let (elements, amounts) = get_elements_and_amounts(&struc);
    let guesses = oxidation::oxi_state_guesses(&elements, &amounts, 0, None, false, None);

    if guesses.is_empty() {
        return Err(PyValueError::new_err(
            "No valid oxidation state assignments found",
        ));
    }

    // Apply the best guess (first one) - map element to oxidation state
    let best = &guesses[0];
    let mut result = struc.clone();
    for site_occ in result.site_occupancies.iter_mut() {
        for (sp, _) in site_occ.species.iter_mut() {
            if let Some(&oxi) = best.oxidation_states.get(sp.element.symbol()) {
                sp.oxidation_state = Some(oxi.round() as i8);
            }
        }
    }
    Ok(structure_to_pydict(py, &result)?.unbind())
}

/// Compute bond valence sums.
#[gen_stub_pyfunction]
#[pyfunction]
#[pyo3(signature = (structure, max_radius = 4.0, scale_factor = 1.0))]
fn compute_bv_sums(
    structure: StructureJson,
    max_radius: f64,
    scale_factor: f64,
) -> PyResult<Vec<f64>> {
    if max_radius <= 0.0 || !max_radius.is_finite() {
        return Err(PyValueError::new_err(
            "max_radius must be positive and finite",
        ));
    }
    if scale_factor <= 0.0 || !scale_factor.is_finite() {
        return Err(PyValueError::new_err(
            "scale_factor must be positive and finite",
        ));
    }
    let struc = parse_struct(&structure)?;
    // Compute BV sum for each site using neighbor list
    let mut sums = Vec::with_capacity(struc.num_sites());
    let all_neighbors = struc.get_all_neighbors(max_radius);

    for (site_idx, site_neighbors) in all_neighbors.iter().enumerate() {
        let site_element = struc.site_occupancies[site_idx].dominant_species().element;
        let bv_neighbors: Vec<oxidation::BvNeighbor> = site_neighbors
            .iter()
            .map(|&(neighbor_idx, distance, _image)| {
                let neighbor_site = &struc.site_occupancies[neighbor_idx];
                let (neighbor_sp, neighbor_occ) = neighbor_site
                    .species
                    .iter()
                    .max_by(|a, b| a.1.partial_cmp(&b.1).unwrap())
                    .unwrap();
                oxidation::BvNeighbor {
                    element: neighbor_sp.element,
                    distance,
                    occupancy: *neighbor_occ,
                }
            })
            .collect();
        sums.push(oxidation::calculate_bv_sum(
            site_element,
            &bv_neighbors,
            scale_factor,
        ));
    }
    Ok(sums)
}

/// Guess oxidation states using structure's composition.
#[gen_stub_pyfunction]
#[pyfunction]
fn guess_oxidation_states(py: Python<'_>, structure: StructureJson) -> PyResult<Py<PyDict>> {
    let struc = parse_struct(&structure)?;
    let (elements, amounts) = get_elements_and_amounts(&struc);
    let guesses = oxidation::oxi_state_guesses(&elements, &amounts, 0, None, false, None);

    if guesses.is_empty() {
        return Err(PyValueError::new_err(
            "No valid oxidation state assignments found",
        ));
    }

    let best = &guesses[0];
    let dict = PyDict::new(py);
    for (elem, oxi) in &best.oxidation_states {
        dict.set_item(elem, *oxi)?;
    }
    Ok(dict.unbind())
}

/// Add oxidation states by element.
#[gen_stub_pyfunction]
#[pyfunction]
fn add_oxidation_state_by_element(
    py: Python<'_>,
    structure: StructureJson,
    oxi_states: std::collections::HashMap<String, i8>,
) -> PyResult<Py<PyDict>> {
    let mut struc = parse_struct(&structure)?;
    for site_occ in struc.site_occupancies.iter_mut() {
        for (sp, _) in site_occ.species.iter_mut() {
            if let Some(&oxi) = oxi_states.get(sp.element.symbol()) {
                sp.oxidation_state = Some(oxi);
            }
        }
    }
    Ok(structure_to_pydict(py, &struc)?.unbind())
}

/// Add oxidation states by site.
#[gen_stub_pyfunction]
#[pyfunction]
fn add_oxidation_state_by_site(
    py: Python<'_>,
    structure: StructureJson,
    oxi_states: Vec<i8>,
) -> PyResult<Py<PyDict>> {
    let mut struc = parse_struct(&structure)?;
    if oxi_states.len() != struc.num_sites() {
        return Err(PyValueError::new_err(format!(
            "Number of oxidation states ({}) must match number of sites ({})",
            oxi_states.len(),
            struc.num_sites()
        )));
    }
    for (idx, &oxi) in oxi_states.iter().enumerate() {
        for (sp, _) in struc.site_occupancies[idx].species.iter_mut() {
            sp.oxidation_state = Some(oxi);
        }
    }
    Ok(structure_to_pydict(py, &struc)?.unbind())
}

/// Remove oxidation states from a structure.
#[gen_stub_pyfunction]
#[pyfunction]
fn remove_oxidation_states(py: Python<'_>, structure: StructureJson) -> PyResult<Py<PyDict>> {
    let mut struc = parse_struct(&structure)?;
    for site_occ in struc.site_occupancies.iter_mut() {
        for (sp, _) in site_occ.species.iter_mut() {
            sp.oxidation_state = None;
        }
    }
    Ok(structure_to_pydict(py, &struc)?.unbind())
}

/// Register the oxidation submodule.
pub fn register(parent: &Bound<'_, PyModule>) -> PyResult<()> {
    let submod = PyModule::new(parent.py(), "oxidation")?;
    submod.add_function(wrap_pyfunction!(oxi_state_guesses, &submod)?)?;
    submod.add_function(wrap_pyfunction!(
        add_charges_from_oxi_state_guesses,
        &submod
    )?)?;
    submod.add_function(wrap_pyfunction!(compute_bv_sums, &submod)?)?;
    submod.add_function(wrap_pyfunction!(guess_oxidation_states, &submod)?)?;
    submod.add_function(wrap_pyfunction!(add_oxidation_state_by_element, &submod)?)?;
    submod.add_function(wrap_pyfunction!(add_oxidation_state_by_site, &submod)?)?;
    submod.add_function(wrap_pyfunction!(remove_oxidation_states, &submod)?)?;
    parent.add_submodule(&submod)?;
    Ok(())
}
