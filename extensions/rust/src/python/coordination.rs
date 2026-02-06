//! Coordination number analysis.

use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use pyo3::types::PyDict;
use pyo3_stub_gen::derive::gen_stub_pyfunction;

use crate::coordination;

use super::helpers::{StructureJson, check_site_idx, parse_struct};

fn validate_cutoff(cutoff: f64) -> PyResult<()> {
    if !cutoff.is_finite() || cutoff <= 0.0 {
        return Err(PyValueError::new_err("cutoff must be positive and finite"));
    }
    Ok(())
}

/// Create VoronoiConfig with the given min_solid_angle.
#[cfg(not(target_arch = "wasm32"))]
fn voronoi_config(min_solid_angle: f64) -> coordination::VoronoiConfig {
    coordination::VoronoiConfig { min_solid_angle }
}

/// Get coordination numbers for all sites.
#[gen_stub_pyfunction]
#[pyfunction]
fn get_coordination_numbers(structure: StructureJson, cutoff: f64) -> PyResult<Vec<usize>> {
    validate_cutoff(cutoff)?;
    let struc = parse_struct(&structure)?;
    Ok(coordination::get_coordination_numbers(&struc, cutoff))
}

/// Get the coordination number for a single site.
#[gen_stub_pyfunction]
#[pyfunction]
fn get_coordination_number(
    structure: StructureJson,
    site_idx: usize,
    cutoff: f64,
) -> PyResult<usize> {
    validate_cutoff(cutoff)?;
    let struc = parse_struct(&structure)?;
    check_site_idx(site_idx, struc.num_sites())?;
    Ok(coordination::get_coordination_number(
        &struc, site_idx, cutoff,
    ))
}

/// Get the local environment for a site.
#[gen_stub_pyfunction]
#[pyfunction]
fn get_local_environment(
    py: Python<'_>,
    structure: StructureJson,
    site_idx: usize,
    cutoff: f64,
) -> PyResult<Vec<Py<PyDict>>> {
    validate_cutoff(cutoff)?;
    let struc = parse_struct(&structure)?;
    check_site_idx(site_idx, struc.num_sites())?;
    let neighbors = coordination::get_local_environment(&struc, site_idx, cutoff);

    neighbors
        .into_iter()
        .map(|neighbor| {
            let dict = PyDict::new(py);
            dict.set_item("site_idx", neighbor.site_idx)?;
            dict.set_item("species", neighbor.species.to_string())?;
            dict.set_item("distance", neighbor.distance)?;
            dict.set_item("image", neighbor.image)?;
            Ok(dict.unbind())
        })
        .collect()
}

/// Get neighbors for a site.
#[gen_stub_pyfunction]
#[pyfunction]
fn get_neighbors(
    py: Python<'_>,
    structure: StructureJson,
    site_idx: usize,
    cutoff: f64,
) -> PyResult<Vec<Py<PyDict>>> {
    validate_cutoff(cutoff)?;
    let struc = parse_struct(&structure)?;
    check_site_idx(site_idx, struc.num_sites())?;
    let neighbors = coordination::get_neighbors(&struc, site_idx, cutoff);

    neighbors
        .into_iter()
        .map(|(neighbor_idx, distance, image)| {
            let species = struc.site_occupancies[neighbor_idx]
                .dominant_species()
                .to_string();
            let dict = PyDict::new(py);
            dict.set_item("site_idx", neighbor_idx)?;
            dict.set_item("species", species)?;
            dict.set_item("distance", distance)?;
            dict.set_item("image", image)?;
            Ok(dict.unbind())
        })
        .collect()
}

/// Validate min_solid_angle is finite and non-negative.
fn validate_min_solid_angle(min_solid_angle: f64) -> PyResult<()> {
    if !min_solid_angle.is_finite() || min_solid_angle < 0.0 {
        return Err(PyValueError::new_err(format!(
            "min_solid_angle must be finite and non-negative, got {min_solid_angle}"
        )));
    }
    Ok(())
}

/// Get coordination number using Voronoi tessellation.
#[cfg(not(target_arch = "wasm32"))]
#[gen_stub_pyfunction]
#[pyfunction]
#[pyo3(signature = (structure, site_idx, min_solid_angle = 0.1))]
fn get_cn_voronoi(
    structure: StructureJson,
    site_idx: usize,
    min_solid_angle: f64,
) -> PyResult<f64> {
    validate_min_solid_angle(min_solid_angle)?;
    let struc = parse_struct(&structure)?;
    check_site_idx(site_idx, struc.num_sites())?;
    Ok(struc.get_cn_voronoi(site_idx, Some(&voronoi_config(min_solid_angle))))
}

/// Get Voronoi coordination numbers for all sites.
#[cfg(not(target_arch = "wasm32"))]
#[gen_stub_pyfunction]
#[pyfunction]
#[pyo3(signature = (structure, min_solid_angle = 0.1))]
fn get_cn_voronoi_all(structure: StructureJson, min_solid_angle: f64) -> PyResult<Vec<f64>> {
    validate_min_solid_angle(min_solid_angle)?;
    let struc = parse_struct(&structure)?;
    Ok(struc.get_cn_voronoi_all(Some(&voronoi_config(min_solid_angle))))
}

/// Get Voronoi neighbors for a site.
#[cfg(not(target_arch = "wasm32"))]
#[gen_stub_pyfunction]
#[pyfunction]
#[pyo3(signature = (structure, site_idx, min_solid_angle = 0.1))]
fn get_voronoi_neighbors(
    structure: StructureJson,
    site_idx: usize,
    min_solid_angle: f64,
) -> PyResult<Vec<(usize, f64)>> {
    validate_min_solid_angle(min_solid_angle)?;
    let struc = parse_struct(&structure)?;
    check_site_idx(site_idx, struc.num_sites())?;
    Ok(coordination::get_voronoi_neighbors(
        &struc,
        site_idx,
        Some(&voronoi_config(min_solid_angle)),
    ))
}

/// Get Voronoi-based local environment for a site.
#[cfg(not(target_arch = "wasm32"))]
#[gen_stub_pyfunction]
#[pyfunction]
#[pyo3(signature = (structure, site_idx, min_solid_angle = 0.1))]
fn get_local_environment_voronoi(
    py: Python<'_>,
    structure: StructureJson,
    site_idx: usize,
    min_solid_angle: f64,
) -> PyResult<Vec<Py<PyDict>>> {
    validate_min_solid_angle(min_solid_angle)?;
    let struc = parse_struct(&structure)?;
    check_site_idx(site_idx, struc.num_sites())?;
    let env = coordination::get_local_environment_voronoi(
        &struc,
        site_idx,
        Some(&voronoi_config(min_solid_angle)),
    );

    env.into_iter()
        .map(|neighbor| {
            let dict = PyDict::new(py);
            dict.set_item("site_idx", neighbor.site_idx)?;
            dict.set_item("species", neighbor.species.to_string())?;
            dict.set_item("distance", neighbor.distance)?;
            dict.set_item("solid_angle", neighbor.solid_angle)?;
            dict.set_item("image", neighbor.image)?;
            Ok(dict.unbind())
        })
        .collect()
}

/// Register the coordination submodule.
pub fn register(parent: &Bound<'_, PyModule>) -> PyResult<()> {
    let submod = PyModule::new(parent.py(), "coordination")?;
    submod.add_function(wrap_pyfunction!(get_coordination_numbers, &submod)?)?;
    submod.add_function(wrap_pyfunction!(get_coordination_number, &submod)?)?;
    submod.add_function(wrap_pyfunction!(get_local_environment, &submod)?)?;
    submod.add_function(wrap_pyfunction!(get_neighbors, &submod)?)?;
    #[cfg(not(target_arch = "wasm32"))]
    {
        submod.add_function(wrap_pyfunction!(get_cn_voronoi, &submod)?)?;
        submod.add_function(wrap_pyfunction!(get_cn_voronoi_all, &submod)?)?;
        submod.add_function(wrap_pyfunction!(get_voronoi_neighbors, &submod)?)?;
        submod.add_function(wrap_pyfunction!(get_local_environment_voronoi, &submod)?)?;
    }
    parent.add_submodule(&submod)?;
    Ok(())
}
