//! Python bindings for ferrox.
//!
//! This module provides PyO3 bindings to expose the Rust StructureMatcher
//! to Python code.

// PyO3 proc macros generate code that triggers false positive clippy warnings
#![allow(clippy::useless_conversion)]

use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use pyo3::types::{PyDict, PyList};
use std::collections::HashMap;
use std::path::Path;

use crate::error::Result;
use crate::io::{
    parse_extxyz_trajectory, parse_structure, parse_structure_json, structure_to_pymatgen_json,
};
use crate::matcher::{ComparatorType, StructureMatcher};
use crate::structure::Structure;

/// Parse a pair of structure JSON strings, returning a PyResult.
fn parse_structure_pair(struct1: &str, struct2: &str) -> PyResult<(Structure, Structure)> {
    let s1 = parse_structure_json(struct1)
        .map_err(|e| PyValueError::new_err(format!("Error parsing struct1: {e}")))?;
    let s2 = parse_structure_json(struct2)
        .map_err(|e| PyValueError::new_err(format!("Error parsing struct2: {e}")))?;
    Ok((s1, s2))
}

/// Convert Vec<String> to Vec<&str> for batch operations.
fn to_str_refs(strings: &[String]) -> Vec<&str> {
    strings.iter().map(|s| s.as_str()).collect()
}

/// Python wrapper for StructureMatcher.
///
/// Provides structure matching functionality from Python, accepting
/// structures as JSON strings (from pymatgen's Structure.as_dict()).
#[pyclass(name = "StructureMatcher")]
pub struct PyStructureMatcher {
    inner: StructureMatcher,
}

#[pymethods]
impl PyStructureMatcher {
    /// Create a new StructureMatcher.
    ///
    /// Args:
    ///     latt_len_tol: Fractional length tolerance for lattice vectors (default: 0.2).
    ///     site_pos_tol: Site position tolerance, normalized (default: 0.3).
    ///     angle_tol: Angle tolerance in degrees (default: 5.0)
    ///     primitive_cell: Whether to reduce to primitive cell (default: True)
    ///     scale: Whether to scale volumes to match (default: True)
    ///     attempt_supercell: Whether to try supercell matching (default: False)
    ///     comparator: "species" or "element" (default: "species")
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

    /// Check if two structures match.
    ///
    /// Args:
    ///     struct1: First structure as JSON string (from Structure.as_dict())
    ///     struct2: Second structure as JSON string
    ///     skip_structure_reduction: If True, skip Niggli and primitive cell reduction.
    ///         Only use this with structures from `reduce_structure()`. (default: False)
    ///
    /// Returns:
    ///     True if structures match within tolerances.
    ///
    /// Example:
    ///     >>> import json
    ///     >>> from ferrox import StructureMatcher
    ///     >>> matcher = StructureMatcher()
    ///     >>> s1 = Structure(...)
    ///     >>> s2 = Structure(...)
    ///     >>> # Normal usage
    ///     >>> matcher.fit(json.dumps(s1.as_dict()), json.dumps(s2.as_dict()))
    ///     >>> # With pre-reduced structures (for batch comparisons)
    ///     >>> r1 = matcher.reduce_structure(json.dumps(s1.as_dict()))
    ///     >>> r2 = matcher.reduce_structure(json.dumps(s2.as_dict()))
    ///     >>> matcher.fit(r1, r2, skip_structure_reduction=True)
    #[pyo3(signature = (struct1, struct2, skip_structure_reduction = false))]
    fn fit(&self, struct1: &str, struct2: &str, skip_structure_reduction: bool) -> PyResult<bool> {
        let (s1, s2) = parse_structure_pair(struct1, struct2)?;
        Ok(if skip_structure_reduction {
            self.inner.fit_preprocessed(&s1, &s2)
        } else {
            self.inner.fit(&s1, &s2)
        })
    }

    /// Get RMS distance between two structures.
    ///
    /// Args:
    ///     struct1: First structure as JSON string
    ///     struct2: Second structure as JSON string
    ///
    /// Returns:
    ///     Tuple of (rms, max_dist) if structures match, None otherwise.
    fn get_rms_dist(&self, struct1: &str, struct2: &str) -> PyResult<Option<(f64, f64)>> {
        let (s1, s2) = parse_structure_pair(struct1, struct2)?;
        Ok(self.inner.get_rms_dist(&s1, &s2))
    }

    /// Deduplicate a list of structures.
    ///
    /// Args:
    ///     structures: List of structure JSON strings
    ///
    /// Returns:
    ///     List where result[i] is the index of the first structure matching structure i.
    ///
    /// Example:
    ///     >>> structures = [s.as_dict() for s in my_structures]
    ///     >>> json_strs = [json.dumps(s) for s in structures]
    ///     >>> indices = matcher.deduplicate(json_strs)
    fn deduplicate(&self, py: Python<'_>, structures: Vec<String>) -> PyResult<Vec<usize>> {
        // Release GIL during heavy computation
        py.detach(|| {
            self.inner
                .deduplicate_json(&to_str_refs(&structures))
                .map_err(|e| PyValueError::new_err(e.to_string()))
        })
    }

    /// Group structures into equivalence classes.
    ///
    /// Args:
    ///     structures: List of structure JSON strings
    ///
    /// Returns:
    ///     Dict mapping canonical index to list of equivalent structure indices.
    ///
    /// Example:
    ///     >>> groups = matcher.group(json_strs)
    ///     >>> for canonical, members in groups.items():
    ///     ...     print(f"Group {canonical}: {members}")
    fn group(
        &self,
        py: Python<'_>,
        structures: Vec<String>,
    ) -> PyResult<HashMap<usize, Vec<usize>>> {
        // Release GIL during heavy computation
        py.detach(|| {
            self.inner
                .group_json(&to_str_refs(&structures))
                .map(|m| m.into_iter().collect())
                .map_err(|e| PyValueError::new_err(e.to_string()))
        })
    }

    /// Get unique structures from a list.
    ///
    /// Args:
    ///     structures: List of structure JSON strings
    ///
    /// Returns:
    ///     List of indices of unique (first occurrence) structures.
    fn get_unique_indices(&self, structures: Vec<String>) -> PyResult<Vec<usize>> {
        let dedup = self
            .inner
            .deduplicate_json(&to_str_refs(&structures))
            .map_err(|e| PyValueError::new_err(e.to_string()))?;

        // Get indices where result[i] == i (first occurrences)
        let unique: Vec<usize> = dedup
            .iter()
            .enumerate()
            .filter(|&(idx, &canonical)| idx == canonical)
            .map(|(idx, _)| idx)
            .collect();

        Ok(unique)
    }

    /// Find matches for new structures against existing (already-deduplicated) structures.
    ///
    /// This is optimized for the common deduplication scenario where you have a small
    /// batch of new structures (~100) and a large set of existing structures (~28,000)
    /// that are already deduplicated.
    ///
    /// Args:
    ///     new_structures: List of new structure JSON strings to check
    ///     existing_structures: List of existing (already-deduplicated) structure JSON strings
    ///
    /// Returns:
    ///     List where result[i] is the index of the matching existing structure,
    ///     or None if new structure i has no match.
    ///
    /// Example:
    ///     >>> # 100 new structures, 28000 existing
    ///     >>> matches = matcher.find_matches(new_json_strs, existing_json_strs)
    ///     >>> for i, match_idx in enumerate(matches):
    ///     ...     if match_idx is not None:
    ///     ...         print(f"New {i} matches existing {match_idx}")
    ///     ...     else:
    ///     ...         print(f"New {i} is unique")
    ///
    /// Performance:
    ///     - Skips comparing existing structures against each other (already deduplicated)
    ///     - Uses composition hashing to filter candidates
    ///     - Early termination on first match
    ///     - Parallelized across new structures
    fn find_matches(
        &self,
        py: Python<'_>,
        new_structures: Vec<String>,
        existing_structures: Vec<String>,
    ) -> PyResult<Vec<Option<usize>>> {
        // Release GIL during heavy computation to allow other Python threads to run
        py.detach(|| {
            self.inner
                .find_matches_json(
                    &to_str_refs(&new_structures),
                    &to_str_refs(&existing_structures),
                )
                .map_err(|e| PyValueError::new_err(e.to_string()))
        })
    }

    /// Apply Niggli reduction and optionally primitive cell reduction to a structure.
    ///
    /// Use this to pre-reduce structures before calling `fit(..., skip_structure_reduction=True)`.
    /// This is an optimization for comparing many structures - reduce once, compare many times.
    ///
    /// Args:
    ///     structure: Structure as JSON string (from Structure.as_dict())
    ///
    /// Returns:
    ///     Reduced structure as JSON string (pymatgen-compatible format).
    ///
    /// Example:
    ///     >>> # Pre-reduce structures for batch comparison
    ///     >>> reduced_structs = [matcher.reduce_structure(s) for s in json_strs]
    ///     >>> # Now compare without redundant reduction
    ///     >>> for i, s1 in enumerate(reduced_structs):
    ///     ...     for s2 in reduced_structs[i+1:]:
    ///     ...         matcher.fit(s1, s2, skip_structure_reduction=True)
    fn reduce_structure(&self, py: Python<'_>, structure: &str) -> PyResult<String> {
        let s = parse_structure_json(structure)
            .map_err(|e| PyValueError::new_err(format!("Error parsing structure: {e}")))?;
        // Release GIL during reduction (supports batch usage in loops)
        let reduced = py.detach(|| self.inner.reduce_structure(&s));
        Ok(structure_to_pymatgen_json(&reduced))
    }

    fn __repr__(&self) -> String {
        let sm = &self.inner;
        // Use Python-style True/False for booleans
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

    /// Get the lattice length tolerance.
    #[getter]
    fn latt_len_tol(&self) -> f64 {
        self.inner.latt_len_tol
    }

    /// Get the site position tolerance.
    #[getter]
    fn site_pos_tol(&self) -> f64 {
        self.inner.site_pos_tol
    }

    /// Get the angle tolerance.
    #[getter]
    fn angle_tol(&self) -> f64 {
        self.inner.angle_tol
    }

    /// Get whether primitive cell reduction is enabled.
    #[getter]
    fn primitive_cell(&self) -> bool {
        self.inner.primitive_cell
    }

    /// Get whether volume scaling is enabled.
    #[getter]
    fn scale(&self) -> bool {
        self.inner.scale
    }

    /// Get whether supercell matching is enabled.
    #[getter]
    fn attempt_supercell(&self) -> bool {
        self.inner.attempt_supercell
    }
}

// ============================================================================
// Structure I/O Functions
// ============================================================================

/// Convert a Structure to a Python dict in pymatgen format.
fn structure_to_pydict<'py>(
    py: Python<'py>,
    structure: &Structure,
) -> PyResult<Bound<'py, PyDict>> {
    let dict = PyDict::new(py);

    // Pymatgen markers
    dict.set_item("@module", "pymatgen.core.structure")?;
    dict.set_item("@class", "Structure")?;

    // Lattice
    let lattice_dict = PyDict::new(py);
    let mat = structure.lattice.matrix();
    let matrix = PyList::new(
        py,
        [
            PyList::new(py, [mat[(0, 0)], mat[(0, 1)], mat[(0, 2)]])?,
            PyList::new(py, [mat[(1, 0)], mat[(1, 1)], mat[(1, 2)]])?,
            PyList::new(py, [mat[(2, 0)], mat[(2, 1)], mat[(2, 2)]])?,
        ],
    )?;
    lattice_dict.set_item("matrix", matrix)?;
    lattice_dict.set_item(
        "pbc",
        PyList::new(
            py,
            [
                structure.lattice.pbc[0],
                structure.lattice.pbc[1],
                structure.lattice.pbc[2],
            ],
        )?,
    )?;
    dict.set_item("lattice", lattice_dict)?;

    // Sites
    let sites = PyList::empty(py);
    for (sp, coord) in structure.species.iter().zip(structure.frac_coords.iter()) {
        let site = PyDict::new(py);

        // Species list
        let species_entry = PyDict::new(py);
        species_entry.set_item("element", sp.element.symbol())?;
        species_entry.set_item("occu", 1.0)?;
        if let Some(oxi) = sp.oxidation_state {
            species_entry.set_item("oxidation_state", oxi)?;
        }
        let species_list = PyList::new(py, [species_entry])?;
        site.set_item("species", species_list)?;

        // Coordinates
        site.set_item("abc", PyList::new(py, [coord.x, coord.y, coord.z])?)?;
        site.set_item("properties", PyDict::new(py))?;

        sites.append(site)?;
    }
    dict.set_item("sites", sites)?;

    // Properties
    let props = PyDict::new(py);
    for (key, value) in &structure.properties {
        // Convert serde_json::Value to Python object
        let py_value = json_to_py(py, value)?;
        props.set_item(key, py_value)?;
    }
    dict.set_item("properties", props)?;

    Ok(dict)
}

/// Convert serde_json::Value to Python object.
fn json_to_py(py: Python<'_>, value: &serde_json::Value) -> PyResult<PyObject> {
    use pyo3::IntoPyObject;

    match value {
        serde_json::Value::Null => Ok(py.None()),
        serde_json::Value::Bool(b) => {
            let py_bool = b.into_pyobject(py)?;
            Ok(py_bool.to_owned().unbind().into_any())
        }
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                let py_int = i.into_pyobject(py)?;
                Ok(py_int.unbind().into_any())
            } else if let Some(u) = n.as_u64() {
                // Handle large unsigned integers that don't fit in i64
                let py_int = u.into_pyobject(py)?;
                Ok(py_int.unbind().into_any())
            } else if let Some(f) = n.as_f64() {
                let py_float = f.into_pyobject(py)?;
                Ok(py_float.unbind().into_any())
            } else {
                Ok(py.None())
            }
        }
        serde_json::Value::String(s) => {
            let py_str = s.into_pyobject(py)?;
            Ok(py_str.unbind().into_any())
        }
        serde_json::Value::Array(arr) => {
            let list = PyList::empty(py);
            for item in arr {
                list.append(json_to_py(py, item)?)?;
            }
            Ok(list.unbind().into_any())
        }
        serde_json::Value::Object(obj) => {
            let dict = PyDict::new(py);
            for (key, val) in obj {
                dict.set_item(key, json_to_py(py, val)?)?;
            }
            Ok(dict.unbind().into_any())
        }
    }
}

/// Parse a structure file (auto-detects format from extension).
///
/// Supports:
/// - `.json` - Pymatgen JSON format
/// - `.cif` - Crystallographic Information File
/// - `.xyz`, `.extxyz` - Extended XYZ format
/// - `POSCAR*`, `CONTCAR*`, `.vasp` - VASP POSCAR format
///
/// Args:
///     path: Path to the structure file
///
/// Returns:
///     dict: Structure as a Python dict compatible with pymatgen's Structure.from_dict()
///
/// Example:
///     >>> from ferrox import parse_structure_file
///     >>> from pymatgen.core import Structure
///     >>> struct_dict = parse_structure_file("structure.cif")
///     >>> structure = Structure.from_dict(struct_dict)
#[pyfunction]
fn parse_structure_file(py: Python<'_>, path: &str) -> PyResult<Py<PyDict>> {
    let structure = parse_structure(Path::new(path))
        .map_err(|e| PyValueError::new_err(format!("Error parsing {path}: {e}")))?;

    Ok(structure_to_pydict(py, &structure)?.unbind())
}

/// Parse trajectory file (extXYZ format).
///
/// Loads all frames from a trajectory file into a list of structure dicts.
///
/// Args:
///     path: Path to the trajectory file (xyz/extxyz format)
///
/// Returns:
///     List of pymatgen-compatible structure dicts, one per frame
///
/// Example:
///     >>> from ferrox import parse_trajectory
///     >>> frames = parse_trajectory("trajectory.xyz")
///     >>> for frame_dict in frames:
///     ...     structure = Structure.from_dict(frame_dict)
///     ...     print(structure.composition)
#[pyfunction]
fn parse_trajectory(py: Python<'_>, path: &str) -> PyResult<Vec<Py<PyDict>>> {
    let frames = parse_extxyz_trajectory(Path::new(path))
        .map_err(|e| PyValueError::new_err(e.to_string()))?;

    let mut results = Vec::new();
    for frame_result in frames {
        let structure =
            frame_result.map_err(|e| PyValueError::new_err(format!("Frame parse error: {e}")))?;
        results.push(structure_to_pydict(py, &structure)?.unbind());
    }

    Ok(results)
}

/// Register Python module contents.
pub fn register(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<PyStructureMatcher>()?;
    m.add_function(wrap_pyfunction!(parse_structure_file, m)?)?;
    m.add_function(wrap_pyfunction!(parse_trajectory, m)?)?;
    Ok(())
}
