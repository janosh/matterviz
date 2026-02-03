//! Elastic tensor calculations.

use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;

use crate::elastic;

use super::helpers::{array_to_mat3, mat3_to_array};

/// Generate strain matrices for elastic constant calculation.
#[pyfunction]
#[pyo3(signature = (magnitude = 0.01, shear = true))]
fn generate_strains(magnitude: f64, shear: bool) -> Vec<[[f64; 3]; 3]> {
    elastic::generate_strains(magnitude, shear)
        .into_iter()
        .map(|m| mat3_to_array(&m))
        .collect()
}

/// Apply a strain to a cell matrix.
#[pyfunction]
fn apply_strain(cell: [[f64; 3]; 3], strain: [[f64; 3]; 3]) -> [[f64; 3]; 3] {
    mat3_to_array(&elastic::apply_strain(
        &array_to_mat3(cell),
        &array_to_mat3(strain),
    ))
}

/// Convert stress tensor to Voigt notation.
#[pyfunction]
fn stress_to_voigt(stress: [[f64; 3]; 3]) -> [f64; 6] {
    elastic::stress_to_voigt(&array_to_mat3(stress))
}

/// Convert strain tensor to Voigt notation.
#[pyfunction]
fn strain_to_voigt(strain: [[f64; 3]; 3]) -> [f64; 6] {
    elastic::strain_to_voigt(&array_to_mat3(strain))
}

/// Calculate the elastic tensor from strains and stresses.
#[pyfunction]
fn tensor_from_stresses(
    strains: Vec<[[f64; 3]; 3]>,
    stresses: Vec<[[f64; 3]; 3]>,
) -> PyResult<[[f64; 6]; 6]> {
    if strains.len() != stresses.len() {
        return Err(PyValueError::new_err(
            "strains and stresses must have same length",
        ));
    }
    if strains.len() < 6 {
        return Err(PyValueError::new_err("Need at least 6 strain/stress pairs"));
    }
    let strain_mats: Vec<_> = strains.iter().map(|&s| array_to_mat3(s)).collect();
    let stress_mats: Vec<_> = stresses.iter().map(|&s| array_to_mat3(s)).collect();
    let (tensor, _) = elastic::try_elastic_tensor_from_stresses(&strain_mats, &stress_mats);
    Ok(tensor)
}

/// Calculate the bulk modulus from elastic tensor.
#[pyfunction]
fn bulk_modulus(tensor: [[f64; 6]; 6]) -> f64 {
    elastic::bulk_modulus(&tensor)
}

/// Calculate the shear modulus from elastic tensor.
#[pyfunction]
fn shear_modulus(tensor: [[f64; 6]; 6]) -> f64 {
    elastic::shear_modulus(&tensor)
}

/// Calculate Young's modulus from bulk and shear moduli.
#[pyfunction]
fn youngs_modulus(bulk: f64, shear: f64) -> f64 {
    elastic::youngs_modulus(bulk, shear)
}

/// Calculate Poisson's ratio from bulk and shear moduli.
#[pyfunction]
fn poisson_ratio(bulk: f64, shear: f64) -> f64 {
    elastic::poisson_ratio(bulk, shear)
}

/// Check if an elastic tensor indicates mechanical stability.
#[pyfunction]
fn is_stable(tensor: [[f64; 6]; 6]) -> bool {
    elastic::is_mechanically_stable(&tensor)
}

/// Calculate the Zener anisotropy ratio.
#[pyfunction]
fn zener_ratio(c11: f64, c12: f64, c44: f64) -> f64 {
    elastic::zener_ratio(c11, c12, c44)
}

/// Register the elastic submodule.
pub fn register(parent: &Bound<'_, PyModule>) -> PyResult<()> {
    let submod = PyModule::new(parent.py(), "elastic")?;
    submod.add_function(wrap_pyfunction!(generate_strains, &submod)?)?;
    submod.add_function(wrap_pyfunction!(apply_strain, &submod)?)?;
    submod.add_function(wrap_pyfunction!(stress_to_voigt, &submod)?)?;
    submod.add_function(wrap_pyfunction!(strain_to_voigt, &submod)?)?;
    submod.add_function(wrap_pyfunction!(tensor_from_stresses, &submod)?)?;
    submod.add_function(wrap_pyfunction!(bulk_modulus, &submod)?)?;
    submod.add_function(wrap_pyfunction!(shear_modulus, &submod)?)?;
    submod.add_function(wrap_pyfunction!(youngs_modulus, &submod)?)?;
    submod.add_function(wrap_pyfunction!(poisson_ratio, &submod)?)?;
    submod.add_function(wrap_pyfunction!(is_stable, &submod)?)?;
    submod.add_function(wrap_pyfunction!(zener_ratio, &submod)?)?;
    parent.add_submodule(&submod)?;
    Ok(())
}
