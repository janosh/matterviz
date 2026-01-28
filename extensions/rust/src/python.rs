//! Python bindings for ferrox.
//!
//! This module provides PyO3 bindings to expose the Rust StructureMatcher
//! to Python code.

use pyo3::exceptions::PyValueError;
use pyo3::prelude::*;
use std::collections::HashMap;

use crate::io::parse_structure_json;
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
    ///         Also accepts `ltol` for pymatgen compatibility.
    ///     site_pos_tol: Site position tolerance, normalized (default: 0.3).
    ///         Also accepts `stol` for pymatgen compatibility.
    ///     angle_tol: Angle tolerance in degrees (default: 5.0)
    ///     primitive_cell: Whether to reduce to primitive cell (default: False, not yet implemented)
    ///     scale: Whether to scale volumes to match (default: True)
    ///     attempt_supercell: Whether to try supercell matching (default: False)
    ///     comparator: "species" or "element" (default: "species")
    #[new]
    #[pyo3(signature = (
        latt_len_tol = 0.2,
        site_pos_tol = 0.3,
        angle_tol = 5.0,
        primitive_cell = false,
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
                )))
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
    ///     >>> matcher.fit(json.dumps(s1.as_dict()), json.dumps(s2.as_dict()))
    fn fit(&self, struct1: &str, struct2: &str) -> PyResult<bool> {
        let (s1, s2) = parse_structure_pair(struct1, struct2)?;
        Ok(self.inner.fit(&s1, &s2))
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
    fn deduplicate(&self, structures: Vec<String>) -> PyResult<Vec<usize>> {
        let str_refs: Vec<&str> = structures.iter().map(|s| s.as_str()).collect();
        self.inner
            .deduplicate_json(&str_refs)
            .map_err(|e| PyValueError::new_err(e.to_string()))
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
    fn group(&self, structures: Vec<String>) -> PyResult<HashMap<usize, Vec<usize>>> {
        let str_refs: Vec<&str> = structures.iter().map(|s| s.as_str()).collect();
        self.inner
            .group_json(&str_refs)
            .map(|m| m.into_iter().collect())
            .map_err(|e| PyValueError::new_err(e.to_string()))
    }

    /// Get unique structures from a list.
    ///
    /// Args:
    ///     structures: List of structure JSON strings
    ///
    /// Returns:
    ///     List of indices of unique (first occurrence) structures.
    fn get_unique_indices(&self, structures: Vec<String>) -> PyResult<Vec<usize>> {
        let str_refs: Vec<&str> = structures.iter().map(|s| s.as_str()).collect();
        let dedup = self
            .inner
            .deduplicate_json(&str_refs)
            .map_err(|e| PyValueError::new_err(e.to_string()))?;

        // Get indices where result[i] == i (first occurrences)
        let unique: Vec<usize> = dedup
            .iter()
            .enumerate()
            .filter(|(idx, &canonical)| *idx == canonical)
            .map(|(idx, _)| idx)
            .collect();

        Ok(unique)
    }

    fn __repr__(&self) -> String {
        let sm = &self.inner;
        // Use Python-style True/False for booleans
        let py_bool = |b: bool| if b { "True" } else { "False" };
        format!(
            "StructureMatcher(latt_len_tol={}, site_pos_tol={}, angle_tol={}, \
             primitive_cell={}, scale={}, attempt_supercell={})",
            sm.latt_len_tol, sm.site_pos_tol, sm.angle_tol,
            py_bool(sm.primitive_cell), py_bool(sm.scale), py_bool(sm.attempt_supercell)
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

/// Register Python module contents.
pub fn register(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_class::<PyStructureMatcher>()?;
    Ok(())
}
