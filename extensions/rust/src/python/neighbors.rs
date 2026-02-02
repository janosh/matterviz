//! Distance and neighbor calculations.

use pyo3::prelude::*;

use super::helpers::{StructureJson, check_site_idx, check_site_pair, parse_struct};

/// Get the neighbor list for a structure.
/// Returns (center_indices, neighbor_indices, images, distances) as separate lists.
#[pyfunction]
fn get_neighbor_list(
    structure: StructureJson,
    cutoff: f64,
) -> PyResult<(Vec<usize>, Vec<usize>, Vec<[i32; 3]>, Vec<f64>)> {
    if cutoff < 0.0 {
        return Err(pyo3::exceptions::PyValueError::new_err(
            "cutoff must be non-negative",
        ));
    }

    let struc = parse_struct(&structure)?;
    let neighbors = struc.get_all_neighbors(cutoff);

    let mut centers = Vec::new();
    let mut neighbor_indices = Vec::new();
    let mut images = Vec::new();
    let mut distances = Vec::new();

    for (site_idx, site_neighbors) in neighbors.into_iter().enumerate() {
        for (neighbor_idx, distance, image) in site_neighbors {
            centers.push(site_idx);
            neighbor_indices.push(neighbor_idx);
            images.push(image);
            distances.push(distance);
        }
    }

    Ok((centers, neighbor_indices, images, distances))
}

/// Get the distance between two sites.
#[pyfunction]
fn get_distance(structure: StructureJson, idx_a: usize, idx_b: usize) -> PyResult<f64> {
    let struc = parse_struct(&structure)?;
    check_site_pair(idx_a, idx_b, struc.num_sites())?;
    Ok(struc.get_distance(idx_a, idx_b))
}

/// Get the distance matrix.
#[pyfunction]
fn distance_matrix(structure: StructureJson) -> PyResult<Vec<Vec<f64>>> {
    let struc = parse_struct(&structure)?;
    Ok(struc.distance_matrix())
}

/// Get the distance and periodic image between two sites.
#[pyfunction]
fn get_distance_and_image(
    structure: StructureJson,
    idx_a: usize,
    idx_b: usize,
) -> PyResult<(f64, [i32; 3])> {
    let struc = parse_struct(&structure)?;
    check_site_pair(idx_a, idx_b, struc.num_sites())?;
    Ok(struc.get_distance_and_image(idx_a, idx_b))
}

/// Get the distance from a site to a point.
#[pyfunction]
fn distance_from_point(structure: StructureJson, idx: usize, point: [f64; 3]) -> PyResult<f64> {
    let struc = parse_struct(&structure)?;
    check_site_idx(idx, struc.num_sites())?;
    let coords = struc.cart_coords();
    let cart = &coords[idx];
    let pt = nalgebra::Vector3::new(point[0], point[1], point[2]);
    Ok((cart - pt).norm())
}

/// Check if two sites are periodic images of each other.
#[pyfunction]
fn is_periodic_image(
    structure: StructureJson,
    idx_a: usize,
    idx_b: usize,
    tolerance: f64,
) -> PyResult<bool> {
    if tolerance < 0.0 {
        return Err(pyo3::exceptions::PyValueError::new_err(
            "tolerance must be non-negative",
        ));
    }
    let struc = parse_struct(&structure)?;
    check_site_pair(idx_a, idx_b, struc.num_sites())?;
    Ok(struc.is_periodic_image(idx_a, idx_b, tolerance))
}

/// Register the neighbors submodule.
pub fn register(parent: &Bound<'_, PyModule>) -> PyResult<()> {
    let submod = PyModule::new(parent.py(), "neighbors")?;
    submod.add_function(wrap_pyfunction!(get_neighbor_list, &submod)?)?;
    submod.add_function(wrap_pyfunction!(get_distance, &submod)?)?;
    submod.add_function(wrap_pyfunction!(distance_matrix, &submod)?)?;
    submod.add_function(wrap_pyfunction!(get_distance_and_image, &submod)?)?;
    submod.add_function(wrap_pyfunction!(distance_from_point, &submod)?)?;
    submod.add_function(wrap_pyfunction!(is_periodic_image, &submod)?)?;
    parent.add_submodule(&submod)?;
    Ok(())
}
