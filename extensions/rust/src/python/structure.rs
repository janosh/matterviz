//! Structure manipulation and matching functions.

use std::collections::HashMap;

use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use pyo3::types::PyDict;

use crate::io::structure_to_pymatgen_json;
use crate::structure_matcher::{ComparatorType, StructureMatcher};

use super::helpers::{
    StructureJson, parse_reduction_algo, parse_struct, parse_structure_pair, structure_to_pydict,
    to_str_refs,
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

/// Register the structure submodule.
pub fn register(parent: &Bound<'_, PyModule>) -> PyResult<()> {
    let submod = PyModule::new(parent.py(), "structure")?;
    submod.add_class::<PyStructureMatcher>()?;
    submod.add_function(wrap_pyfunction!(make_supercell, &submod)?)?;
    submod.add_function(wrap_pyfunction!(make_supercell_diag, &submod)?)?;
    submod.add_function(wrap_pyfunction!(get_reduced_structure, &submod)?)?;
    submod.add_function(wrap_pyfunction!(copy_structure, &submod)?)?;
    submod.add_function(wrap_pyfunction!(wrap_to_unit_cell, &submod)?)?;
    submod.add_function(wrap_pyfunction!(interpolate, &submod)?)?;
    submod.add_function(wrap_pyfunction!(get_sorted_structure, &submod)?)?;
    submod.add_function(wrap_pyfunction!(get_structure_metadata, &submod)?)?;
    submod.add_function(wrap_pyfunction!(matches, &submod)?)?;
    parent.add_submodule(&submod)?;
    Ok(())
}
