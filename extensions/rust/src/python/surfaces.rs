//! Surface and slab operations.

use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use pyo3::types::{PyDict, PyList};
use pyo3_stub_gen::derive::gen_stub_pyfunction;

use crate::surfaces;

use crate::io::structure_to_pymatgen_json;

use super::helpers::{
    StructureJson, json_to_pydict, parse_struct, structure_to_pydict, validate_positive_f64,
};

/// Validate slab generation parameters.
fn validate_slab_params(min_slab_size: f64, min_vacuum_size: f64, symprec: f64) -> PyResult<()> {
    validate_positive_f64(min_slab_size, "min_slab_size")?;
    validate_positive_f64(min_vacuum_size, "min_vacuum_size")?;
    validate_positive_f64(symprec, "symprec")
}

/// Generate all slabs for a given Miller index (all terminations).
#[gen_stub_pyfunction]
#[pyfunction]
#[pyo3(signature = (structure, miller_index, min_slab_size = 10.0, min_vacuum_size = 10.0, center_slab = true, in_unit_planes = false, symprec = 0.01))]
fn generate_slabs(
    py: Python<'_>,
    structure: StructureJson,
    miller_index: [i32; 3],
    min_slab_size: f64,
    min_vacuum_size: f64,
    center_slab: bool,
    in_unit_planes: bool,
    symprec: f64,
) -> PyResult<Vec<Py<PyDict>>> {
    validate_slab_params(min_slab_size, min_vacuum_size, symprec)?;
    let struc = parse_struct(&structure)?;
    let config = crate::structure::SlabConfig {
        miller_index,
        min_slab_size,
        min_vacuum_size,
        center_slab,
        in_unit_planes,
        primitive: false,
        symprec,
        termination_index: None,
    };
    let slabs = py
        .detach(|| struc.generate_slabs(&config))
        .map_err(|err| PyValueError::new_err(format!("Error generating slabs: {err}")))?;
    slabs
        .iter()
        .map(|slab| Ok(structure_to_pydict(py, slab)?.unbind()))
        .collect()
}

/// Generate a single slab for a given Miller index and termination.
#[gen_stub_pyfunction]
#[pyfunction]
#[pyo3(signature = (structure, miller_index, min_slab_size = 10.0, min_vacuum_size = 10.0, center_slab = true, in_unit_planes = false, symprec = 0.01, termination_index = 0))]
fn make_slab(
    py: Python<'_>,
    structure: StructureJson,
    miller_index: [i32; 3],
    min_slab_size: f64,
    min_vacuum_size: f64,
    center_slab: bool,
    in_unit_planes: bool,
    symprec: f64,
    termination_index: usize,
) -> PyResult<Py<PyDict>> {
    validate_slab_params(min_slab_size, min_vacuum_size, symprec)?;
    let struc = parse_struct(&structure)?;
    let config = crate::structure::SlabConfig {
        miller_index,
        min_slab_size,
        min_vacuum_size,
        center_slab,
        in_unit_planes,
        primitive: false,
        symprec,
        termination_index: Some(termination_index),
    };
    let slab = py
        .detach(|| struc.make_slab(&config))
        .map_err(|err| PyValueError::new_err(format!("Error making slab: {err}")))?;
    Ok(structure_to_pydict(py, &slab)?.unbind())
}

/// Enumerate terminations for a given Miller index.
#[gen_stub_pyfunction]
#[pyfunction]
#[pyo3(signature = (structure, h, k, l, min_slab = 10.0, min_vacuum = 10.0, symprec = 0.01))]
fn enumerate_terminations(
    py: Python<'_>,
    structure: StructureJson,
    h: i32,
    k: i32,
    l: i32,
    min_slab: f64,
    min_vacuum: f64,
    symprec: f64,
) -> PyResult<Vec<Py<PyDict>>> {
    validate_slab_params(min_slab, min_vacuum, symprec)?;
    let struc = parse_struct(&structure)?;
    let miller = surfaces::MillerIndex::new(h, k, l);
    let config = surfaces::SlabConfigExt::new(miller)
        .with_min_slab_size(min_slab)
        .with_min_vacuum(min_vacuum);

    let terminations = surfaces::enumerate_terminations(&struc, miller, &config, symprec)
        .map_err(|err| PyValueError::new_err(err.to_string()))?;

    terminations
        .into_iter()
        .map(|term| {
            let dict = PyDict::new(py);
            dict.set_item("miller_index", term.miller_index.to_array())?;
            dict.set_item("shift", term.shift)?;
            let species_strs: Vec<String> = term
                .surface_species
                .iter()
                .map(|sp| sp.to_string())
                .collect();
            dict.set_item("surface_species", species_strs)?;
            dict.set_item("surface_density", term.surface_density)?;
            dict.set_item("is_polar", term.is_polar)?;
            let slab_json = structure_to_pymatgen_json(&term.slab);
            dict.set_item("slab", json_to_pydict(py, &slab_json)?)?;
            Ok(dict.unbind())
        })
        .collect()
}

/// Enumerate Miller indices up to a maximum value.
#[gen_stub_pyfunction]
#[pyfunction]
fn enumerate_miller(max_index: i32) -> Vec<[i32; 3]> {
    if max_index < 1 {
        return vec![];
    }
    let miller_list = surfaces::enumerate_miller_indices(max_index);
    miller_list.into_iter().map(|m| m.to_array()).collect()
}

/// Parse site type string to enum.
#[inline]
fn parse_site_type(site_type: &str) -> Result<surfaces::AdsorptionSiteType, String> {
    match site_type.to_lowercase().as_str() {
        "atop" | "on_top" => Ok(surfaces::AdsorptionSiteType::Atop),
        "bridge" => Ok(surfaces::AdsorptionSiteType::Bridge),
        "hollow" | "hollow3" => Ok(surfaces::AdsorptionSiteType::Hollow3),
        "hollow4" => Ok(surfaces::AdsorptionSiteType::Hollow4),
        "other" | "other_site" => Ok(surfaces::AdsorptionSiteType::Other),
        _ => Err(format!(
            "Unknown site type: '{site_type}'. Valid types: atop, on_top, bridge, hollow, hollow3, hollow4, other, other_site"
        )),
    }
}

/// Find adsorption sites on a slab.
#[gen_stub_pyfunction]
#[pyfunction]
#[pyo3(signature = (slab, height = 2.0, site_types = None, neighbor_cutoff = None, surface_tolerance = None))]
fn find_adsorption_sites(
    py: Python<'_>,
    slab: StructureJson,
    height: f64,
    site_types: Option<Vec<String>>,
    neighbor_cutoff: Option<f64>,
    surface_tolerance: Option<f64>,
) -> PyResult<Vec<Py<PyDict>>> {
    // Validate numeric inputs
    if !height.is_finite() || height < 0.0 {
        return Err(PyValueError::new_err(format!(
            "height must be finite and non-negative, got {height}"
        )));
    }
    if let Some(cutoff) = neighbor_cutoff {
        if !cutoff.is_finite() || cutoff <= 0.0 {
            return Err(PyValueError::new_err(format!(
                "neighbor_cutoff must be finite and positive, got {cutoff}"
            )));
        }
    }
    if let Some(tol) = surface_tolerance {
        if !tol.is_finite() || tol <= 0.0 {
            return Err(PyValueError::new_err(format!(
                "surface_tolerance must be finite and positive, got {tol}"
            )));
        }
    }

    let struc = parse_struct(&slab)?;

    let site_type_enums: Option<Vec<surfaces::AdsorptionSiteType>> = site_types
        .map(|types| {
            types
                .iter()
                .map(|s| parse_site_type(s).map_err(PyValueError::new_err))
                .collect::<PyResult<_>>()
        })
        .transpose()?;

    let sites = surfaces::find_adsorption_sites(
        &struc,
        height,
        site_type_enums.as_deref(),
        neighbor_cutoff,
        surface_tolerance,
    )
    .map_err(|err| PyValueError::new_err(err.to_string()))?;

    sites
        .into_iter()
        .map(|site| {
            let dict = PyDict::new(py);
            dict.set_item("position", site.position.as_slice())?;
            dict.set_item("cart_position", site.cart_position.as_slice())?;
            dict.set_item(
                "site_type",
                match site.site_type {
                    surfaces::AdsorptionSiteType::Atop => "atop",
                    surfaces::AdsorptionSiteType::Bridge => "bridge",
                    surfaces::AdsorptionSiteType::Hollow3 => "hollow3",
                    surfaces::AdsorptionSiteType::Hollow4 => "hollow4",
                    surfaces::AdsorptionSiteType::Other => "other",
                },
            )?;
            dict.set_item("height", site.height)?;
            dict.set_item("coordinating_atoms", &site.coordinating_atoms)?;
            Ok(dict.unbind())
        })
        .collect()
}

/// Get surface atom indices.
#[gen_stub_pyfunction]
#[pyfunction]
#[pyo3(signature = (slab, tolerance = 0.5))]
fn get_surface_atoms(slab: StructureJson, tolerance: f64) -> PyResult<Vec<usize>> {
    if !tolerance.is_finite() || tolerance <= 0.0 {
        return Err(PyValueError::new_err(format!(
            "tolerance must be finite and positive, got {tolerance}"
        )));
    }
    let struc = parse_struct(&slab)?;
    Ok(surfaces::get_surface_atoms(&struc, tolerance))
}

/// Get the surface area of a slab.
#[gen_stub_pyfunction]
#[pyfunction]
fn area(slab: StructureJson) -> PyResult<f64> {
    let struc = parse_struct(&slab)?;
    Ok(surfaces::surface_area(&struc))
}

/// Calculate surface energy.
#[gen_stub_pyfunction]
#[pyfunction]
fn calculate_energy(
    slab_energy: f64,
    bulk_energy_per_atom: f64,
    n_atoms: usize,
    surface_area: f64,
) -> PyResult<f64> {
    if !surface_area.is_finite() || surface_area <= 0.0 {
        return Err(PyValueError::new_err(
            "surface_area must be positive and finite",
        ));
    }
    if n_atoms == 0 {
        return Err(PyValueError::new_err("n_atoms must be greater than 0"));
    }
    if !slab_energy.is_finite() || !bulk_energy_per_atom.is_finite() {
        return Err(PyValueError::new_err("energies must be finite"));
    }
    Ok(surfaces::calculate_surface_energy(
        slab_energy,
        bulk_energy_per_atom,
        n_atoms,
        surface_area,
    ))
}

/// Calculate d-spacing for a Miller index.
#[gen_stub_pyfunction]
#[pyfunction]
fn d_spacing(structure: StructureJson, h: i32, k: i32, l: i32) -> PyResult<f64> {
    let struc = parse_struct(&structure)?;
    surfaces::d_spacing(&struc.lattice, [h, k, l])
        .map_err(|err| PyValueError::new_err(err.to_string()))
}

/// Compute the Wulff shape from surface energies.
#[gen_stub_pyfunction]
#[pyfunction]
fn compute_wulff(
    py: Python<'_>,
    structure: StructureJson,
    surface_energies: Vec<([i32; 3], f64)>,
) -> PyResult<Py<PyDict>> {
    if surface_energies.is_empty() {
        return Err(PyValueError::new_err("surface_energies must not be empty"));
    }
    for (miller, energy) in &surface_energies {
        if miller == &[0, 0, 0] {
            return Err(PyValueError::new_err("Miller index cannot be [0, 0, 0]"));
        }
        if !energy.is_finite() || *energy <= 0.0 {
            return Err(PyValueError::new_err(
                "Surface energies must be positive and finite",
            ));
        }
    }

    let struc = parse_struct(&structure)?;
    // Convert surface_energies to use MillerIndex
    let miller_energies: Vec<(surfaces::MillerIndex, f64)> = surface_energies
        .into_iter()
        .map(|(m, e)| (surfaces::MillerIndex::new(m[0], m[1], m[2]), e))
        .collect();
    let wulff = surfaces::compute_wulff_shape(&struc.lattice, &miller_energies)
        .map_err(|err| PyValueError::new_err(err.to_string()))?;

    let dict = PyDict::new(py);
    dict.set_item("volume", wulff.volume)?;
    dict.set_item("surface_area", wulff.total_surface_area)?;
    dict.set_item("sphericity", wulff.sphericity)?;

    let facets = PyList::empty(py);
    for facet in &wulff.facets {
        let fd = PyDict::new(py);
        fd.set_item("miller_index", facet.miller_index.to_array())?;
        fd.set_item("area_fraction", facet.area_fraction)?;
        fd.set_item("surface_energy", facet.surface_energy)?;
        // Compute normal vector for this facet
        let normal = surfaces::miller_to_normal(&struc.lattice, facet.miller_index.to_array());
        fd.set_item("normal", [normal.x, normal.y, normal.z])?;
        facets.append(fd)?;
    }
    dict.set_item("facets", facets)?;

    Ok(dict.unbind())
}

/// Convert Miller index to a normal vector.
#[gen_stub_pyfunction]
#[pyfunction]
fn miller_to_normal(structure: StructureJson, miller: [i32; 3]) -> PyResult<[f64; 3]> {
    let struc = parse_struct(&structure)?;
    let normal = surfaces::miller_to_normal(&struc.lattice, miller);
    Ok([normal.x, normal.y, normal.z])
}

/// Register the surfaces submodule.
pub fn register(parent: &Bound<'_, PyModule>) -> PyResult<()> {
    let submod = PyModule::new(parent.py(), "surfaces")?;
    submod.add_function(wrap_pyfunction!(generate_slabs, &submod)?)?;
    submod.add_function(wrap_pyfunction!(make_slab, &submod)?)?;
    submod.add_function(wrap_pyfunction!(enumerate_terminations, &submod)?)?;
    submod.add_function(wrap_pyfunction!(enumerate_miller, &submod)?)?;
    submod.add_function(wrap_pyfunction!(find_adsorption_sites, &submod)?)?;
    submod.add_function(wrap_pyfunction!(get_surface_atoms, &submod)?)?;
    submod.add_function(wrap_pyfunction!(area, &submod)?)?;
    submod.add_function(wrap_pyfunction!(calculate_energy, &submod)?)?;
    submod.add_function(wrap_pyfunction!(d_spacing, &submod)?)?;
    submod.add_function(wrap_pyfunction!(compute_wulff, &submod)?)?;
    submod.add_function(wrap_pyfunction!(miller_to_normal, &submod)?)?;
    parent.add_submodule(&submod)?;
    Ok(())
}
