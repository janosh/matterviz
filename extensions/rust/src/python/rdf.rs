//! Radial distribution function calculations.

use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use pyo3::types::PyDict;

use crate::rdf;

use super::helpers::{StructureJson, parse_struct};

/// Validate RDF parameters.
#[inline]
fn validate_rdf_params(r_max: f64, n_bins: usize) -> PyResult<()> {
    if !r_max.is_finite() || r_max <= 0.0 {
        return Err(PyValueError::new_err("r_max must be positive and finite"));
    }
    if n_bins == 0 {
        return Err(PyValueError::new_err("n_bins must be greater than 0"));
    }
    Ok(())
}

/// Compute the radial distribution function.
#[pyfunction]
#[pyo3(signature = (structure, r_max = 10.0, n_bins = 100))]
fn compute_rdf(
    py: Python<'_>,
    structure: StructureJson,
    r_max: f64,
    n_bins: usize,
) -> PyResult<Py<PyDict>> {
    validate_rdf_params(r_max, n_bins)?;
    let struc = parse_struct(&structure)?;

    let options = rdf::RdfOptions {
        r_max,
        n_bins,
        ..Default::default()
    };

    let result = rdf::compute_rdf(&struc, &options);

    let dict = PyDict::new(py);
    dict.set_item("radii", result.radii.clone())?;
    dict.set_item("g_of_r", result.g_of_r.clone())?;
    Ok(dict.unbind())
}

/// Compute the element-specific RDF.
#[pyfunction]
#[pyo3(signature = (structure, element1, element2, r_max = 10.0, n_bins = 100))]
fn compute_element_rdf(
    py: Python<'_>,
    structure: StructureJson,
    element1: &str,
    element2: &str,
    r_max: f64,
    n_bins: usize,
) -> PyResult<Py<PyDict>> {
    validate_rdf_params(r_max, n_bins)?;
    let struc = parse_struct(&structure)?;

    let elem1 = crate::element::Element::from_symbol(element1).ok_or_else(|| {
        pyo3::exceptions::PyValueError::new_err(format!("Unknown element: {element1}"))
    })?;
    let elem2 = crate::element::Element::from_symbol(element2).ok_or_else(|| {
        pyo3::exceptions::PyValueError::new_err(format!("Unknown element: {element2}"))
    })?;

    let options = rdf::RdfOptions {
        r_max,
        n_bins,
        ..Default::default()
    };

    let result = rdf::compute_element_rdf(&struc, elem1, elem2, &options);

    let dict = PyDict::new(py);
    dict.set_item("radii", result.radii.clone())?;
    dict.set_item("g_of_r", result.g_of_r.clone())?;
    Ok(dict.unbind())
}

/// Compute RDFs for all element pairs.
#[pyfunction]
#[pyo3(signature = (structure, r_max = 10.0, n_bins = 100))]
fn compute_all_element_rdfs(
    py: Python<'_>,
    structure: StructureJson,
    r_max: f64,
    n_bins: usize,
) -> PyResult<Py<PyDict>> {
    validate_rdf_params(r_max, n_bins)?;
    let struc = parse_struct(&structure)?;

    let options = rdf::RdfOptions {
        r_max,
        n_bins,
        ..Default::default()
    };

    let results = rdf::compute_all_element_rdfs(&struc, &options);

    let dict = PyDict::new(py);
    for (elem1, elem2, result) in results {
        let pair_key = format!("{}-{}", elem1.symbol(), elem2.symbol());
        let pair_dict = PyDict::new(py);
        pair_dict.set_item("radii", result.radii.clone())?;
        pair_dict.set_item("g_of_r", result.g_of_r.clone())?;
        dict.set_item(pair_key, pair_dict)?;
    }
    Ok(dict.unbind())
}

/// Register the rdf submodule.
pub fn register(parent: &Bound<'_, PyModule>) -> PyResult<()> {
    let submod = PyModule::new(parent.py(), "rdf")?;
    submod.add_function(wrap_pyfunction!(compute_rdf, &submod)?)?;
    submod.add_function(wrap_pyfunction!(compute_element_rdf, &submod)?)?;
    submod.add_function(wrap_pyfunction!(compute_all_element_rdfs, &submod)?)?;
    parent.add_submodule(&submod)?;
    Ok(())
}
