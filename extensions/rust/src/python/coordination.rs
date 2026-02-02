//! Coordination number analysis.

use pyo3::prelude::*;
use pyo3::types::PyDict;

use crate::coordination;

use super::helpers::{StructureJson, check_site_idx, parse_struct};

/// Get coordination numbers for all sites.
#[pyfunction]
fn get_coordination_numbers(structure: StructureJson, cutoff: f64) -> PyResult<Vec<usize>> {
    let struc = parse_struct(&structure)?;
    Ok(coordination::get_coordination_numbers(&struc, cutoff))
}

/// Get the coordination number for a single site.
#[pyfunction]
fn get_coordination_number(
    structure: StructureJson,
    site_idx: usize,
    cutoff: f64,
) -> PyResult<usize> {
    let struc = parse_struct(&structure)?;
    check_site_idx(site_idx, struc.num_sites())?;
    Ok(coordination::get_coordination_number(
        &struc, site_idx, cutoff,
    ))
}

/// Get the local environment for a site.
#[pyfunction]
fn get_local_environment(
    py: Python<'_>,
    structure: StructureJson,
    site_idx: usize,
    cutoff: f64,
) -> PyResult<Vec<Py<PyDict>>> {
    let struc = parse_struct(&structure)?;
    check_site_idx(site_idx, struc.num_sites())?;
    let neighbors = coordination::get_local_environment(&struc, site_idx, cutoff);

    neighbors
        .into_iter()
        .map(|neighbor| {
            let dict = PyDict::new(py);
            dict.set_item("species", neighbor.species.to_string())?;
            dict.set_item("distance", neighbor.distance)?;
            Ok(dict.unbind())
        })
        .collect()
}

/// Get neighbors for a site.
#[pyfunction]
fn get_neighbors(
    py: Python<'_>,
    structure: StructureJson,
    site_idx: usize,
    cutoff: f64,
) -> PyResult<Vec<Py<PyDict>>> {
    let struc = parse_struct(&structure)?;
    check_site_idx(site_idx, struc.num_sites())?;
    let neighbors = coordination::get_neighbors(&struc, site_idx, cutoff);

    neighbors
        .into_iter()
        .map(|(site_idx, distance, image)| {
            let dict = PyDict::new(py);
            dict.set_item("site_idx", site_idx)?;
            dict.set_item("distance", distance)?;
            dict.set_item("image", image)?;
            Ok(dict.unbind())
        })
        .collect()
}

/// Get coordination number using Voronoi tessellation.
#[cfg(not(target_arch = "wasm32"))]
#[pyfunction]
#[pyo3(signature = (structure, site_idx, min_solid_angle = 0.1))]
fn get_cn_voronoi(
    structure: StructureJson,
    site_idx: usize,
    min_solid_angle: f64,
) -> PyResult<f64> {
    let struc = parse_struct(&structure)?;
    check_site_idx(site_idx, struc.num_sites())?;
    let config = coordination::VoronoiConfig {
        min_solid_angle,
        ..Default::default()
    };
    Ok(struc.get_cn_voronoi(site_idx, Some(&config)))
}

/// Get Voronoi coordination numbers for all sites.
#[cfg(not(target_arch = "wasm32"))]
#[pyfunction]
#[pyo3(signature = (structure, min_solid_angle = 0.1))]
fn get_cn_voronoi_all(structure: StructureJson, min_solid_angle: f64) -> PyResult<Vec<f64>> {
    let struc = parse_struct(&structure)?;
    let config = coordination::VoronoiConfig {
        min_solid_angle,
        ..Default::default()
    };
    Ok(struc.get_cn_voronoi_all(Some(&config)))
}

/// Get Voronoi neighbors for a site.
#[cfg(not(target_arch = "wasm32"))]
#[pyfunction]
#[pyo3(signature = (structure, site_idx, min_solid_angle = 0.1))]
fn get_voronoi_neighbors(
    structure: StructureJson,
    site_idx: usize,
    min_solid_angle: f64,
) -> PyResult<Vec<(usize, f64)>> {
    let struc = parse_struct(&structure)?;
    check_site_idx(site_idx, struc.num_sites())?;
    let config = coordination::VoronoiConfig {
        min_solid_angle,
        ..Default::default()
    };
    Ok(coordination::get_voronoi_neighbors(
        &struc,
        site_idx,
        Some(&config),
    ))
}

/// Get Voronoi-based local environment for a site.
#[cfg(not(target_arch = "wasm32"))]
#[pyfunction]
#[pyo3(signature = (structure, site_idx, min_solid_angle = 0.1))]
fn get_local_environment_voronoi(
    py: Python<'_>,
    structure: StructureJson,
    site_idx: usize,
    min_solid_angle: f64,
) -> PyResult<Vec<Py<PyDict>>> {
    use pyo3::types::PyList;

    let struc = parse_struct(&structure)?;
    check_site_idx(site_idx, struc.num_sites())?;
    let config = coordination::VoronoiConfig {
        min_solid_angle,
        ..Default::default()
    };
    let env = coordination::get_local_environment_voronoi(&struc, site_idx, Some(&config));

    env.into_iter()
        .map(|neighbor| {
            let dict = PyDict::new(py);
            dict.set_item("site_idx", neighbor.site_idx)?;
            dict.set_item("species", neighbor.species.to_string())?;
            dict.set_item("distance", neighbor.distance)?;
            dict.set_item("weight", neighbor.weight)?;
            dict.set_item("solid_angle", neighbor.solid_angle)?;
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
