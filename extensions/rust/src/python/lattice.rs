//! Lattice operations.

use pyo3::prelude::*;
use pyo3_stub_gen::derive::gen_stub_pyfunction;

use super::helpers::{StructureJson, mat3_to_array, parse_struct};

/// Get the lattice metric tensor.
#[gen_stub_pyfunction]
#[pyfunction]
fn get_metric_tensor(structure: StructureJson) -> PyResult<[[f64; 3]; 3]> {
    let struc = parse_struct(&structure)?;
    Ok(mat3_to_array(&struc.lattice.metric_tensor()))
}

/// Get the inverse lattice matrix.
#[gen_stub_pyfunction]
#[pyfunction]
fn get_inv_matrix(structure: StructureJson) -> PyResult<[[f64; 3]; 3]> {
    let struc = parse_struct(&structure)?;
    Ok(mat3_to_array(&struc.lattice.inv_matrix()))
}

/// Get the reciprocal lattice matrix.
#[gen_stub_pyfunction]
#[pyfunction]
fn get_reciprocal_lattice(structure: StructureJson) -> PyResult<[[f64; 3]; 3]> {
    let struc = parse_struct(&structure)?;
    Ok(mat3_to_array(struc.lattice.reciprocal().matrix()))
}

/// Get the LLL-reduced lattice.
#[gen_stub_pyfunction]
#[pyfunction]
#[pyo3(signature = (structure, delta = 0.75))]
fn get_lll_reduced_lattice(structure: StructureJson, delta: f64) -> PyResult<[[f64; 3]; 3]> {
    if !delta.is_finite() || delta <= 0.25 || delta > 1.0 {
        return Err(pyo3::exceptions::PyValueError::new_err(
            "delta must be in range (0.25, 1.0] for LLL reduction",
        ));
    }
    let struc = parse_struct(&structure)?;
    Ok(mat3_to_array(struc.lattice.get_lll_reduced(delta).matrix()))
}

/// Get the LLL reduction mapping matrix.
#[gen_stub_pyfunction]
#[pyfunction]
fn get_lll_mapping(structure: StructureJson) -> PyResult<[[f64; 3]; 3]> {
    let struc = parse_struct(&structure)?;
    Ok(mat3_to_array(&struc.lattice.lll_mapping()))
}

/// Register the lattice submodule.
pub fn register(parent: &Bound<'_, PyModule>) -> PyResult<()> {
    let submod = PyModule::new(parent.py(), "lattice")?;
    submod.add_function(wrap_pyfunction!(get_metric_tensor, &submod)?)?;
    submod.add_function(wrap_pyfunction!(get_inv_matrix, &submod)?)?;
    submod.add_function(wrap_pyfunction!(get_reciprocal_lattice, &submod)?)?;
    submod.add_function(wrap_pyfunction!(get_lll_reduced_lattice, &submod)?)?;
    submod.add_function(wrap_pyfunction!(get_lll_mapping, &submod)?)?;
    parent.add_submodule(&submod)?;
    Ok(())
}
