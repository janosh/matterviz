//! Structure manipulation and matching functions.

use std::collections::HashMap;

use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use pyo3::types::PyDict;

use crate::io::structure_to_pymatgen_json;
use crate::structure_matcher::{ComparatorType, StructureMatcher};

use pyo3::types::PyList;

use super::helpers::{
    StructureJson, parse_reduction_algo, parse_struct, parse_structure_pair, props_to_pydict,
    py_to_json_value, structure_to_pydict, to_str_refs,
};

/// Python wrapper for StructureMatcher.
#[pyclass(name = "StructureMatcher")]
pub struct PyStructureMatcher {
    inner: StructureMatcher,
}

#[pymethods]
impl PyStructureMatcher {
    #[new]
    #[pyo3(signature = (
        latt_len_tol = 0.2,
        site_pos_tol = 0.3,
        angle_tol = 5.0,
        primitive_cell = true,
        scale = true,
        attempt_supercell = false,
        comparator = "species"
    ))]
    fn new(
        latt_len_tol: f64,
        site_pos_tol: f64,
        angle_tol: f64,
        primitive_cell: bool,
        scale: bool,
        attempt_supercell: bool,
        comparator: &str,
    ) -> PyResult<Self> {
        let comparator_type = match comparator {
            "species" => ComparatorType::Species,
            "element" => ComparatorType::Element,
            _ => {
                return Err(PyValueError::new_err(format!(
                    "Invalid comparator: {comparator}. Use 'species' or 'element'"
                )));
            }
        };

        let inner = StructureMatcher::new()
            .with_latt_len_tol(latt_len_tol)
            .with_site_pos_tol(site_pos_tol)
            .with_angle_tol(angle_tol)
            .with_primitive_cell(primitive_cell)
            .with_scale(scale)
            .with_attempt_supercell(attempt_supercell)
            .with_comparator(comparator_type);

        Ok(Self { inner })
    }

    #[pyo3(signature = (struct1, struct2, skip_structure_reduction = false))]
    fn fit(
        &self,
        struct1: StructureJson,
        struct2: StructureJson,
        skip_structure_reduction: bool,
    ) -> PyResult<bool> {
        let (s1, s2) = parse_structure_pair(&struct1, &struct2)?;
        Ok(if skip_structure_reduction {
            self.inner.fit_preprocessed(&s1, &s2)
        } else {
            self.inner.fit(&s1, &s2)
        })
    }

    fn get_rms_dist(
        &self,
        struct1: StructureJson,
        struct2: StructureJson,
    ) -> PyResult<Option<(f64, f64)>> {
        let (s1, s2) = parse_structure_pair(&struct1, &struct2)?;
        Ok(self.inner.get_rms_dist(&s1, &s2))
    }

    fn get_structure_distance(
        &self,
        struct1: StructureJson,
        struct2: StructureJson,
    ) -> PyResult<f64> {
        let (s1, s2) = parse_structure_pair(&struct1, &struct2)?;
        Ok(self.inner.get_structure_distance(&s1, &s2))
    }

    fn fit_anonymous(&self, struct1: StructureJson, struct2: StructureJson) -> PyResult<bool> {
        let (s1, s2) = parse_structure_pair(&struct1, &struct2)?;
        Ok(self.inner.fit_anonymous(&s1, &s2))
    }

    fn deduplicate(&self, py: Python<'_>, structures: Vec<String>) -> PyResult<Vec<usize>> {
        py.detach(|| {
            self.inner
                .deduplicate_json(&to_str_refs(&structures))
                .map_err(|err| PyValueError::new_err(err.to_string()))
        })
    }

    fn group(
        &self,
        py: Python<'_>,
        structures: Vec<String>,
    ) -> PyResult<HashMap<usize, Vec<usize>>> {
        py.detach(|| {
            self.inner
                .group_json(&to_str_refs(&structures))
                .map(|m| m.into_iter().collect())
                .map_err(|err| PyValueError::new_err(err.to_string()))
        })
    }

    fn get_unique_indices(&self, structures: Vec<String>) -> PyResult<Vec<usize>> {
        let dedup = self
            .inner
            .deduplicate_json(&to_str_refs(&structures))
            .map_err(|err| PyValueError::new_err(err.to_string()))?;

        Ok(dedup
            .iter()
            .enumerate()
            .filter_map(|(idx, &canonical)| (idx == canonical).then_some(idx))
            .collect())
    }

    fn find_matches(
        &self,
        py: Python<'_>,
        new_structures: Vec<String>,
        existing_structures: Vec<String>,
    ) -> PyResult<Vec<Option<usize>>> {
        py.detach(|| {
            self.inner
                .find_matches_json(
                    &to_str_refs(&new_structures),
                    &to_str_refs(&existing_structures),
                )
                .map_err(|err| PyValueError::new_err(err.to_string()))
        })
    }

    fn reduce_structure(&self, py: Python<'_>, structure: StructureJson) -> PyResult<String> {
        let struc = parse_struct(&structure)?;
        let reduced = py.detach(|| self.inner.reduce_structure(&struc));
        Ok(structure_to_pymatgen_json(&reduced))
    }

    fn __repr__(&self) -> String {
        let sm = &self.inner;
        let py_bool = |b: bool| if b { "True" } else { "False" };
        format!(
            "StructureMatcher(latt_len_tol={}, site_pos_tol={}, angle_tol={}, \
             primitive_cell={}, scale={}, attempt_supercell={})",
            sm.latt_len_tol,
            sm.site_pos_tol,
            sm.angle_tol,
            py_bool(sm.primitive_cell),
            py_bool(sm.scale),
            py_bool(sm.attempt_supercell)
        )
    }

    #[getter]
    fn latt_len_tol(&self) -> f64 {
        self.inner.latt_len_tol
    }

    #[getter]
    fn site_pos_tol(&self) -> f64 {
        self.inner.site_pos_tol
    }

    #[getter]
    fn angle_tol(&self) -> f64 {
        self.inner.angle_tol
    }

    #[getter]
    fn primitive_cell(&self) -> bool {
        self.inner.primitive_cell
    }

    #[getter]
    fn scale(&self) -> bool {
        self.inner.scale
    }

    #[getter]
    fn attempt_supercell(&self) -> bool {
        self.inner.attempt_supercell
    }
}

// === Structure Manipulation Functions ===

/// Create a supercell using a 3x3 transformation matrix.
#[pyfunction]
fn make_supercell(
    py: Python<'_>,
    structure: StructureJson,
    matrix: [[i32; 3]; 3],
) -> PyResult<Py<PyDict>> {
    let struc = parse_struct(&structure)?;
    let supercell = struc
        .make_supercell(matrix)
        .map_err(|err| PyValueError::new_err(err.to_string()))?;
    Ok(structure_to_pydict(py, &supercell)?.unbind())
}

/// Create a diagonal supercell.
#[pyfunction]
fn make_supercell_diag(
    py: Python<'_>,
    structure: StructureJson,
    scaling: [i32; 3],
) -> PyResult<Py<PyDict>> {
    let struc = parse_struct(&structure)?;
    let supercell = struc.make_supercell_diag(scaling);
    Ok(structure_to_pydict(py, &supercell)?.unbind())
}

/// Get a reduced cell structure.
#[pyfunction]
#[pyo3(signature = (structure, algorithm = "niggli"))]
fn get_reduced_structure(
    py: Python<'_>,
    structure: StructureJson,
    algorithm: &str,
) -> PyResult<Py<PyDict>> {
    let struc = parse_struct(&structure)?;
    let algo = parse_reduction_algo(algorithm)?;
    let reduced = struc
        .get_reduced_structure(algo)
        .map_err(|err| PyValueError::new_err(err.to_string()))?;
    Ok(structure_to_pydict(py, &reduced)?.unbind())
}

/// Copy a structure.
#[pyfunction]
fn copy_structure(py: Python<'_>, structure: StructureJson) -> PyResult<Py<PyDict>> {
    let struc = parse_struct(&structure)?;
    Ok(structure_to_pydict(py, &struc)?.unbind())
}

/// Wrap all sites to the unit cell.
#[pyfunction]
fn wrap_to_unit_cell(py: Python<'_>, structure: StructureJson) -> PyResult<Py<PyDict>> {
    let mut struc = parse_struct(&structure)?;
    struc.wrap_to_unit_cell();
    Ok(structure_to_pydict(py, &struc)?.unbind())
}

/// Interpolate between two structures.
#[pyfunction]
#[pyo3(signature = (struct1, struct2, nimages, interpolate_lattices = false, use_pbc = true))]
fn interpolate(
    py: Python<'_>,
    struct1: StructureJson,
    struct2: StructureJson,
    nimages: usize,
    interpolate_lattices: bool,
    use_pbc: bool,
) -> PyResult<Vec<Py<PyDict>>> {
    let (s1, s2) = parse_structure_pair(&struct1, &struct2)?;
    let images = s1
        .interpolate(&s2, nimages, interpolate_lattices, use_pbc)
        .map_err(|err| PyValueError::new_err(err.to_string()))?;
    images
        .iter()
        .map(|img| Ok(structure_to_pydict(py, img)?.unbind()))
        .collect()
}

/// Get structure sorted by species.
#[pyfunction]
#[pyo3(signature = (structure, reverse = false))]
fn get_sorted_structure(
    py: Python<'_>,
    structure: StructureJson,
    reverse: bool,
) -> PyResult<Py<PyDict>> {
    let struc = parse_struct(&structure)?;
    let sorted = struc.get_sorted_structure(reverse);
    Ok(structure_to_pydict(py, &sorted)?.unbind())
}

/// Get structure metadata.
#[pyfunction]
fn get_structure_metadata(py: Python<'_>, structure: StructureJson) -> PyResult<Py<PyDict>> {
    let struc = parse_struct(&structure)?;
    let comp = struc.composition();
    let dict = PyDict::new(py);

    // Formula representations
    dict.set_item("formula", comp.formula())?;
    dict.set_item("formula_anonymous", comp.anonymous_formula())?;
    dict.set_item("formula_hill", comp.hill_formula())?;
    dict.set_item("chemical_system", comp.chemical_system())?;

    // Element info
    let elements: Vec<String> = struc.species_strings();
    let unique_elements: std::collections::HashSet<_> = elements.iter().cloned().collect();
    let mut sorted_elements: Vec<_> = unique_elements.into_iter().collect();
    sorted_elements.sort();
    dict.set_item("elements", sorted_elements.clone())?;
    dict.set_item("n_elements", sorted_elements.len())?;
    dict.set_item("n_sites", struc.num_sites())?;
    dict.set_item("is_ordered", struc.is_ordered())?;

    // Physical properties
    dict.set_item("volume", struc.volume())?;
    dict.set_item("density", struc.density())?;
    dict.set_item("mass", comp.weight())?;

    Ok(dict.unbind())
}

/// Check if two structures match.
#[pyfunction]
#[pyo3(signature = (struct1, struct2, anonymous = false))]
fn matches(struct1: StructureJson, struct2: StructureJson, anonymous: bool) -> PyResult<bool> {
    let (s1, s2) = parse_structure_pair(&struct1, &struct2)?;
    let matcher = StructureMatcher::new();
    Ok(if anonymous {
        matcher.fit_anonymous(&s1, &s2)
    } else {
        matcher.fit(&s1, &s2)
    })
}

// === Structure Transformation Functions ===

/// Substitute one species with another.
#[pyfunction]
fn substitute_species(
    py: Python<'_>,
    structure: StructureJson,
    old_species: &str,
    new_species: &str,
) -> PyResult<Py<PyDict>> {
    let struc = parse_struct(&structure)?;

    let old_elem = crate::element::Element::from_symbol(old_species)
        .ok_or_else(|| PyValueError::new_err(format!("Unknown element: {old_species}")))?;
    let new_elem = crate::element::Element::from_symbol(new_species)
        .ok_or_else(|| PyValueError::new_err(format!("Unknown element: {new_species}")))?;

    let old_sp = crate::species::Species::neutral(old_elem);
    let new_sp = crate::species::Species::neutral(new_elem);

    let result = struc
        .substitute(old_sp, new_sp)
        .map_err(|err| PyValueError::new_err(err.to_string()))?;
    Ok(structure_to_pydict(py, &result)?.unbind())
}

/// Remove all sites of specified species.
#[pyfunction]
fn remove_species(
    py: Python<'_>,
    structure: StructureJson,
    species_list: Vec<String>,
) -> PyResult<Py<PyDict>> {
    let struc = parse_struct(&structure)?;

    // Validate all species symbols first
    let mut species = Vec::with_capacity(species_list.len());
    for sym in &species_list {
        match crate::element::Element::from_symbol(sym) {
            Some(elem) => species.push(crate::species::Species::neutral(elem)),
            None => {
                return Err(PyValueError::new_err(format!(
                    "Unknown species symbol: {sym}"
                )));
            }
        }
    }

    let result = struc
        .remove_species(&species)
        .map_err(|err| PyValueError::new_err(err.to_string()))?;
    Ok(structure_to_pydict(py, &result)?.unbind())
}

/// Remove sites at specified indices.
#[pyfunction]
fn remove_sites(
    py: Python<'_>,
    structure: StructureJson,
    indices: Vec<usize>,
) -> PyResult<Py<PyDict>> {
    let struc = parse_struct(&structure)?;
    let result = struc
        .remove_sites(&indices)
        .map_err(|err| PyValueError::new_err(err.to_string()))?;
    Ok(structure_to_pydict(py, &result)?.unbind())
}

/// Apply a deformation gradient to the structure.
#[pyfunction]
fn deform(
    py: Python<'_>,
    structure: StructureJson,
    gradient: [[f64; 3]; 3],
) -> PyResult<Py<PyDict>> {
    let struc = parse_struct(&structure)?;
    let grad_matrix = nalgebra::Matrix3::from_row_slice(&[
        gradient[0][0],
        gradient[0][1],
        gradient[0][2],
        gradient[1][0],
        gradient[1][1],
        gradient[1][2],
        gradient[2][0],
        gradient[2][1],
        gradient[2][2],
    ]);
    let result = struc
        .deform(grad_matrix)
        .map_err(|err| PyValueError::new_err(err.to_string()))?;
    Ok(structure_to_pydict(py, &result)?.unbind())
}

/// Compute Ewald energy for a structure with oxidation states.
#[pyfunction]
#[pyo3(signature = (structure, eta = None, real_cutoff = None, accuracy = None))]
fn ewald_energy(
    structure: StructureJson,
    eta: Option<f64>,
    real_cutoff: Option<f64>,
    accuracy: Option<f64>,
) -> PyResult<f64> {
    let struc = parse_struct(&structure)?;

    // Validate optional parameters
    if let Some(acc) = accuracy.filter(|&a| a <= 0.0 || !a.is_finite()) {
        return Err(PyValueError::new_err(format!(
            "accuracy must be positive and finite, got {acc}"
        )));
    }
    if let Some(rc) = real_cutoff.filter(|&r| r <= 0.0 || !r.is_finite()) {
        return Err(PyValueError::new_err(format!(
            "real_cutoff must be positive and finite, got {rc}"
        )));
    }

    let mut ewald = crate::algorithms::ewald::Ewald::new();
    if let Some(eta_val) = eta {
        if eta_val <= 0.0 || !eta_val.is_finite() {
            return Err(PyValueError::new_err("eta must be positive and finite"));
        }
        ewald = ewald.with_eta(eta_val);
    }
    if let Some(rc) = real_cutoff {
        ewald = ewald.with_real_cutoff(rc);
    }
    if let Some(acc) = accuracy {
        ewald = ewald.with_accuracy(acc);
    }

    ewald
        .energy(&struc)
        .map_err(|err| PyValueError::new_err(err.to_string()))
}

/// Generate ordered structures from a disordered structure.
#[pyfunction]
#[pyo3(signature = (structure, max_structures = 100))]
fn order_disordered(
    py: Python<'_>,
    structure: StructureJson,
    max_structures: usize,
) -> PyResult<Vec<Py<PyDict>>> {
    let struc = parse_struct(&structure)?;
    let config = crate::transformations::OrderDisorderedConfig {
        max_structures: Some(max_structures),
        ..Default::default()
    };
    let results = struc
        .order_disordered(config)
        .map_err(|err| PyValueError::new_err(err.to_string()))?;

    results
        .iter()
        .map(|s| Ok(structure_to_pydict(py, s)?.unbind()))
        .collect()
}

/// Enumerate derivative structures within a size range.
#[pyfunction]
#[pyo3(signature = (structure, min_size = 1, max_size = 4))]
fn enumerate_derivatives(
    py: Python<'_>,
    structure: StructureJson,
    min_size: usize,
    max_size: usize,
) -> PyResult<Vec<Py<PyDict>>> {
    let struc = parse_struct(&structure)?;
    let results = struc
        .enumerate_derivatives(min_size, max_size)
        .map_err(|err| PyValueError::new_err(err.to_string()))?;

    results
        .iter()
        .map(|s| Ok(structure_to_pydict(py, s)?.unbind()))
        .collect()
}

/// Translate selected sites by a vector.
#[pyfunction]
#[pyo3(signature = (structure, indices, vector, fractional = true))]
fn translate_sites(
    py: Python<'_>,
    structure: StructureJson,
    indices: Vec<usize>,
    vector: [f64; 3],
    fractional: bool,
) -> PyResult<Py<PyDict>> {
    let mut struc = parse_struct(&structure)?;
    let num_sites = struc.num_sites();
    if let Some(&idx) = indices.iter().find(|&&idx| idx >= num_sites) {
        return Err(pyo3::exceptions::PyIndexError::new_err(format!(
            "Site index {idx} out of bounds (num_sites={num_sites})"
        )));
    }
    struc.translate_sites(&indices, nalgebra::Vector3::from(vector), fractional);
    Ok(structure_to_pydict(py, &struc)?.unbind())
}

/// Perturb all sites by random vectors.
#[pyfunction]
#[pyo3(signature = (structure, distance, min_distance = None, seed = None))]
fn perturb(
    py: Python<'_>,
    structure: StructureJson,
    distance: f64,
    min_distance: Option<f64>,
    seed: Option<u64>,
) -> PyResult<Py<PyDict>> {
    if !distance.is_finite() || distance < 0.0 {
        return Err(PyValueError::new_err(
            "distance must be finite and non-negative",
        ));
    }
    if let Some(min_dist) = min_distance {
        if !min_dist.is_finite() || min_dist < 0.0 {
            return Err(PyValueError::new_err(
                "min_distance must be finite and non-negative",
            ));
        }
        if min_dist > distance {
            return Err(PyValueError::new_err("min_distance must be <= distance"));
        }
    }
    let mut struc = parse_struct(&structure)?;
    struc.perturb(distance, min_distance, seed);
    Ok(structure_to_pydict(py, &struc)?.unbind())
}

/// Get labels for all sites.
#[pyfunction]
fn site_labels(structure: StructureJson) -> PyResult<Vec<String>> {
    Ok(parse_struct(&structure)?.site_labels())
}

/// Get species strings for all sites.
#[pyfunction]
fn species_strings(structure: StructureJson) -> PyResult<Vec<String>> {
    Ok(parse_struct(&structure)?.species_strings())
}

/// Get structure with reduced lattice using custom parameters.
#[pyfunction]
#[pyo3(signature = (structure, algorithm = "niggli", niggli_tol = 1e-5, lll_delta = 0.75))]
fn get_reduced_structure_with_params(
    py: Python<'_>,
    structure: StructureJson,
    algorithm: &str,
    niggli_tol: f64,
    lll_delta: f64,
) -> PyResult<Py<PyDict>> {
    let struc = parse_struct(&structure)?;
    let algo = parse_reduction_algo(algorithm)?;
    let reduced = struc
        .get_reduced_structure_with_params(algo, niggli_tol, lll_delta)
        .map_err(|err| PyValueError::new_err(err.to_string()))?;
    Ok(structure_to_pydict(py, &reduced)?.unbind())
}

/// Get structure sorted by electronegativity.
#[pyfunction]
fn get_sorted_by_electronegativity(
    py: Python<'_>,
    structure: StructureJson,
    reverse: Option<bool>,
) -> PyResult<Py<PyDict>> {
    let struc = parse_struct(&structure)?;
    let sorted = struc.get_sorted_by_electronegativity(reverse.unwrap_or(false));
    Ok(structure_to_pydict(py, &sorted)?.unbind())
}

/// Get distance between two sites with a specific periodic image.
#[pyfunction]
fn get_distance_with_image(
    structure: StructureJson,
    idx1: usize,
    idx2: usize,
    jimage: [i32; 3],
) -> PyResult<f64> {
    let struc = parse_struct(&structure)?;
    let num_sites = struc.num_sites();
    if idx1 >= num_sites || idx2 >= num_sites {
        return Err(pyo3::exceptions::PyIndexError::new_err(format!(
            "Site index out of bounds (num_sites={num_sites})"
        )));
    }
    Ok(struc.get_distance_with_image(idx1, idx2, jimage))
}

/// Get site properties for a specific site.
#[pyfunction]
fn get_site_properties(
    py: Python<'_>,
    structure: StructureJson,
    idx: usize,
) -> PyResult<Py<PyDict>> {
    let struc = parse_struct(&structure)?;
    if idx >= struc.num_sites() {
        return Err(pyo3::exceptions::PyIndexError::new_err(format!(
            "Site index {idx} out of bounds for structure with {} sites",
            struc.num_sites()
        )));
    }
    Ok(props_to_pydict(py, struc.site_properties(idx))?.unbind())
}

/// Get all site properties for a structure.
#[pyfunction]
fn get_all_site_properties(py: Python<'_>, structure: StructureJson) -> PyResult<Py<PyList>> {
    let struc = parse_struct(&structure)?;
    let result: Vec<_> = (0..struc.num_sites())
        .map(|idx| props_to_pydict(py, struc.site_properties(idx)))
        .collect::<PyResult<_>>()?;
    Ok(PyList::new(py, result)?.unbind())
}

/// Set a site property.
#[pyfunction]
fn set_site_property(
    py: Python<'_>,
    structure: StructureJson,
    idx: usize,
    key: &str,
    value: Bound<'_, pyo3::PyAny>,
) -> PyResult<Py<PyDict>> {
    let mut struc = parse_struct(&structure)?;
    if idx >= struc.num_sites() {
        return Err(pyo3::exceptions::PyIndexError::new_err(format!(
            "Site index {idx} out of bounds for structure with {} sites",
            struc.num_sites()
        )));
    }
    let json_val = py_to_json_value(&value)?;
    struc.set_site_property(idx, key, json_val);
    Ok(structure_to_pydict(py, &struc)?.unbind())
}

/// Register the structure submodule.
pub fn register(parent: &Bound<'_, PyModule>) -> PyResult<()> {
    let submod = PyModule::new(parent.py(), "structure")?;
    submod.add_class::<PyStructureMatcher>()?;
    submod.add_function(wrap_pyfunction!(make_supercell, &submod)?)?;
    submod.add_function(wrap_pyfunction!(make_supercell_diag, &submod)?)?;
    submod.add_function(wrap_pyfunction!(get_reduced_structure, &submod)?)?;
    submod.add_function(wrap_pyfunction!(
        get_reduced_structure_with_params,
        &submod
    )?)?;
    submod.add_function(wrap_pyfunction!(copy_structure, &submod)?)?;
    submod.add_function(wrap_pyfunction!(wrap_to_unit_cell, &submod)?)?;
    submod.add_function(wrap_pyfunction!(interpolate, &submod)?)?;
    submod.add_function(wrap_pyfunction!(get_sorted_structure, &submod)?)?;
    submod.add_function(wrap_pyfunction!(get_sorted_by_electronegativity, &submod)?)?;
    submod.add_function(wrap_pyfunction!(get_structure_metadata, &submod)?)?;
    submod.add_function(wrap_pyfunction!(matches, &submod)?)?;
    submod.add_function(wrap_pyfunction!(substitute_species, &submod)?)?;
    submod.add_function(wrap_pyfunction!(remove_species, &submod)?)?;
    submod.add_function(wrap_pyfunction!(remove_sites, &submod)?)?;
    submod.add_function(wrap_pyfunction!(deform, &submod)?)?;
    submod.add_function(wrap_pyfunction!(ewald_energy, &submod)?)?;
    submod.add_function(wrap_pyfunction!(order_disordered, &submod)?)?;
    submod.add_function(wrap_pyfunction!(enumerate_derivatives, &submod)?)?;
    submod.add_function(wrap_pyfunction!(translate_sites, &submod)?)?;
    submod.add_function(wrap_pyfunction!(perturb, &submod)?)?;
    submod.add_function(wrap_pyfunction!(site_labels, &submod)?)?;
    submod.add_function(wrap_pyfunction!(species_strings, &submod)?)?;
    submod.add_function(wrap_pyfunction!(get_distance_with_image, &submod)?)?;
    submod.add_function(wrap_pyfunction!(get_site_properties, &submod)?)?;
    submod.add_function(wrap_pyfunction!(get_all_site_properties, &submod)?)?;
    submod.add_function(wrap_pyfunction!(set_site_property, &submod)?)?;
    parent.add_submodule(&submod)?;
    Ok(())
}
