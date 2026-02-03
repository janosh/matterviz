//! Composition analysis functions.

use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use pyo3::types::PyDict;

use crate::composition::Composition;

use super::helpers::parse_comp;

/// Convert a Composition to a simple element dict (element -> amount).
/// Uses get_element_total to aggregate across all oxidation states of an element.
fn comp_to_element_dict(py: Python<'_>, comp: &Composition) -> PyResult<Py<PyDict>> {
    let dict = PyDict::new(py);
    // Use elements() to get unique elements, then get_element_total for each
    for elem in comp.elements() {
        let total = comp.get_element_total(elem);
        dict.set_item(elem.symbol(), total)?;
    }
    Ok(dict.unbind())
}

/// Convert a Composition to a rich metadata dict.
fn comp_to_metadata_dict(py: Python<'_>, comp: &Composition) -> PyResult<Py<PyDict>> {
    let dict = PyDict::new(py);

    // Formula representations
    dict.set_item("formula", comp.formula())?;
    dict.set_item("reduced_formula", comp.reduced_composition().formula())?;
    dict.set_item("formula_anonymous", comp.anonymous_formula())?;
    dict.set_item("formula_hill", comp.hill_formula())?;
    dict.set_item("chemical_system", comp.chemical_system())?;

    // Counts
    dict.set_item("num_atoms", comp.num_atoms())?;
    dict.set_item("num_elements", comp.num_elements())?;

    // Species dict
    let species_dict = comp_to_element_dict(py, comp)?;
    dict.set_item("species", species_dict)?;

    // Physical properties
    dict.set_item("weight", comp.weight())?;

    Ok(dict.unbind())
}

/// Parse a composition formula and return rich metadata.
#[pyfunction]
fn parse_composition(py: Python<'_>, formula: &str) -> PyResult<Py<PyDict>> {
    comp_to_metadata_dict(py, &parse_comp(formula)?)
}

/// Get the atomic fraction of an element.
#[pyfunction]
fn get_atomic_fraction(formula: &str, element: &str) -> PyResult<f64> {
    let comp = parse_comp(formula)?;
    let elem = crate::element::Element::from_symbol(element)
        .ok_or_else(|| PyValueError::new_err(format!("Unknown element: {element}")))?;
    Ok(comp.get_atomic_fraction(crate::species::Species::neutral(elem)))
}

/// Get the weight fraction of an element.
#[pyfunction]
fn get_wt_fraction(formula: &str, element: &str) -> PyResult<f64> {
    let comp = parse_comp(formula)?;
    let elem = crate::element::Element::from_symbol(element)
        .ok_or_else(|| PyValueError::new_err(format!("Unknown element: {element}")))?;
    Ok(comp.get_wt_fraction(crate::species::Species::neutral(elem)))
}

/// Get the reduced composition.
#[pyfunction]
fn reduced_composition(py: Python<'_>, formula: &str) -> PyResult<Py<PyDict>> {
    comp_to_element_dict(py, &parse_comp(formula)?.reduced_composition())
}

/// Get the fractional composition.
#[pyfunction]
fn fractional_composition(py: Python<'_>, formula: &str) -> PyResult<Py<PyDict>> {
    comp_to_element_dict(py, &parse_comp(formula)?.fractional_composition())
}

/// Check if a composition is charge balanced.
#[pyfunction]
fn is_charge_balanced(formula: &str) -> PyResult<Option<bool>> {
    let comp = parse_comp(formula)?;
    Ok(comp.is_charge_balanced())
}

/// Get the total charge of a composition.
#[pyfunction]
fn composition_charge(formula: &str) -> PyResult<Option<i32>> {
    let comp = parse_comp(formula)?;
    Ok(comp.charge())
}

/// Check if two compositions are almost equal.
#[pyfunction]
#[pyo3(signature = (formula1, formula2, rel_tol = 1e-6, abs_tol = 1e-8))]
fn compositions_almost_equal(
    formula1: &str,
    formula2: &str,
    rel_tol: f64,
    abs_tol: f64,
) -> PyResult<bool> {
    let comp1 = parse_comp(formula1)?;
    let comp2 = parse_comp(formula2)?;
    Ok(comp1.almost_equals(&comp2, rel_tol, abs_tol))
}

/// Get a hash of a formula (for fast comparisons).
#[pyfunction]
fn formula_hash(formula: &str) -> PyResult<u64> {
    let comp = parse_comp(formula)?;
    Ok(comp.formula_hash())
}

/// Get a hash based on species (including oxidation states).
#[pyfunction]
fn species_hash(formula: &str) -> PyResult<u64> {
    let comp = parse_comp(formula)?;
    Ok(comp.species_hash())
}

/// Remap elements in a formula.
#[pyfunction]
fn remap_elements(
    py: Python<'_>,
    formula: &str,
    mapping: std::collections::HashMap<String, String>,
) -> PyResult<Py<PyDict>> {
    let comp = parse_comp(formula)?;
    let mut elem_map = std::collections::HashMap::new();
    for (from_sym, to_sym) in mapping {
        let from_elem = crate::element::Element::from_symbol(&from_sym)
            .ok_or_else(|| PyValueError::new_err(format!("Unknown element: {from_sym}")))?;
        let to_elem = crate::element::Element::from_symbol(&to_sym)
            .ok_or_else(|| PyValueError::new_err(format!("Unknown element: {to_sym}")))?;
        elem_map.insert(from_elem, to_elem);
    }
    comp_to_element_dict(py, &comp.remap_elements(&elem_map))
}

/// Get the reduction factor of a formula.
#[pyfunction]
fn get_reduced_factor(formula: &str) -> PyResult<f64> {
    let comp = parse_comp(formula)?;
    Ok(comp.get_reduced_factor())
}

/// Register the composition submodule.
pub fn register(parent: &Bound<'_, PyModule>) -> PyResult<()> {
    let submod = PyModule::new(parent.py(), "composition")?;
    submod.add_function(wrap_pyfunction!(parse_composition, &submod)?)?;
    submod.add_function(wrap_pyfunction!(get_atomic_fraction, &submod)?)?;
    submod.add_function(wrap_pyfunction!(get_wt_fraction, &submod)?)?;
    submod.add_function(wrap_pyfunction!(reduced_composition, &submod)?)?;
    submod.add_function(wrap_pyfunction!(fractional_composition, &submod)?)?;
    submod.add_function(wrap_pyfunction!(is_charge_balanced, &submod)?)?;
    submod.add_function(wrap_pyfunction!(composition_charge, &submod)?)?;
    submod.add_function(wrap_pyfunction!(compositions_almost_equal, &submod)?)?;
    submod.add_function(wrap_pyfunction!(formula_hash, &submod)?)?;
    submod.add_function(wrap_pyfunction!(species_hash, &submod)?)?;
    submod.add_function(wrap_pyfunction!(remap_elements, &submod)?)?;
    submod.add_function(wrap_pyfunction!(get_reduced_factor, &submod)?)?;
    parent.add_submodule(&submod)?;
    Ok(())
}
