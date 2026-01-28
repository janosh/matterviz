//! I/O utilities for structure parsing.
//!
//! This module provides functions for parsing structures from various formats,
//! primarily pymatgen's JSON format (Structure.as_dict()).

use crate::element::Element;
use crate::error::{FerroxError, Result};
use crate::lattice::Lattice;
use crate::species::Species;
use crate::structure::Structure;
use nalgebra::Vector3;
use serde::Deserialize;
use std::path::Path;

/// Represents a species entry in pymatgen JSON.
#[derive(Debug, Deserialize)]
#[allow(dead_code)] // Fields parsed for compatibility but not all used
struct PymatgenSpecies {
    element: String,
    #[serde(default = "default_occu")]
    occu: f64,
    #[serde(default, deserialize_with = "deserialize_oxidation_state")]
    oxidation_state: Option<i32>,
}

/// Deserialize oxidation_state from either integer or float.
fn deserialize_oxidation_state<'de, D>(deserializer: D) -> std::result::Result<Option<i32>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    use serde::de::Error;

    let value: Option<serde_json::Value> = Option::deserialize(deserializer)?;
    match value {
        None => Ok(None),
        Some(serde_json::Value::Null) => Ok(None),
        Some(serde_json::Value::Number(n)) => {
            if let Some(int_val) = n.as_i64() {
                Ok(Some(int_val as i32))
            } else if let Some(float_val) = n.as_f64() {
                Ok(Some(float_val.round() as i32))
            } else {
                Err(D::Error::custom("oxidation_state must be a number"))
            }
        }
        Some(other) => Err(D::Error::custom(format!(
            "oxidation_state must be a number, got {:?}",
            other
        ))),
    }
}

fn default_occu() -> f64 {
    1.0
}

/// Represents a site in pymatgen JSON.
#[derive(Debug, Deserialize)]
#[allow(dead_code)] // Fields parsed for compatibility but not all used
struct PymatgenSite {
    species: Vec<PymatgenSpecies>,
    abc: [f64; 3],
    #[serde(default)]
    xyz: Option<[f64; 3]>,
    #[serde(default)]
    label: Option<String>,
    #[serde(default)]
    properties: serde_json::Value,
}

/// Represents the lattice in pymatgen JSON.
#[derive(Debug, Deserialize)]
#[allow(dead_code)] // pbc parsed for compatibility but not used
struct PymatgenLattice {
    matrix: [[f64; 3]; 3],
    #[serde(default = "default_pbc")]
    pbc: [bool; 3],
}

fn default_pbc() -> [bool; 3] {
    [true, true, true]
}

/// Represents a pymatgen Structure JSON.
#[derive(Debug, Deserialize)]
#[allow(dead_code)] // Fields parsed for compatibility but not all used
struct PymatgenStructure {
    #[serde(rename = "@module")]
    _module: Option<String>,
    #[serde(rename = "@class")]
    _class: Option<String>,
    lattice: PymatgenLattice,
    sites: Vec<PymatgenSite>,
    #[serde(default)]
    charge: Option<f64>,
    #[serde(default)]
    properties: serde_json::Value,
}

/// Parse a structure from pymatgen's JSON format.
///
/// Supports the format produced by `Structure.as_dict()` in pymatgen.
///
/// # Arguments
///
/// * `json` - JSON string in pymatgen Structure.as_dict() format
///
/// # Returns
///
/// The parsed structure or an error if parsing fails.
///
/// # Example
///
/// ```rust,ignore
/// let json = r#"{
///     "lattice": {"matrix": [[4,0,0],[0,4,0],[0,0,4]]},
///     "sites": [{"species": [{"element": "Fe"}], "abc": [0,0,0]}]
/// }"#;
/// let structure = parse_structure_json(json)?;
/// ```
pub fn parse_structure_json(json: &str) -> Result<Structure> {
    let parsed: PymatgenStructure =
        serde_json::from_str(json).map_err(|e| FerroxError::JsonError {
            path: "inline".to_string(),
            reason: e.to_string(),
        })?;

    // Build lattice from row-major matrix
    let m = &parsed.lattice.matrix;
    let matrix = nalgebra::Matrix3::new(
        m[0][0], m[0][1], m[0][2], m[1][0], m[1][1], m[1][2], m[2][0], m[2][1], m[2][2],
    );
    let lattice = Lattice::new(matrix);

    // Build species and coordinates
    let mut species = Vec::with_capacity(parsed.sites.len());
    let mut frac_coords = Vec::with_capacity(parsed.sites.len());

    for (idx, site) in parsed.sites.iter().enumerate() {
        // Handle empty species list
        if site.species.is_empty() {
            return Err(FerroxError::JsonError {
                path: "inline".to_string(),
                reason: format!("Site {idx} has no species"),
            });
        }

        // For now, only handle single-species sites (no disorder)
        if site.species.len() > 1 {
            tracing::warn!(
                "Site {} has {} species (disordered site), using first species only",
                idx,
                site.species.len()
            );
        }
        let sp_json = &site.species[0];

        let element =
            Element::from_symbol(&sp_json.element).ok_or_else(|| FerroxError::JsonError {
                path: "inline".to_string(),
                reason: format!("Unknown element: {}", sp_json.element),
            })?;

        let sp = if let Some(oxi) = sp_json.oxidation_state {
            if oxi < i8::MIN as i32 || oxi > i8::MAX as i32 {
                return Err(FerroxError::JsonError {
                    path: "inline".to_string(),
                    reason: format!("Oxidation state {oxi} out of range [-128, 127]"),
                });
            }
            Species::new(element, Some(oxi as i8))
        } else {
            Species::neutral(element)
        };

        species.push(sp);
        frac_coords.push(Vector3::new(site.abc[0], site.abc[1], site.abc[2]));
    }

    Ok(Structure::new(lattice, species, frac_coords))
}

/// Parse a structure from a JSON file.
///
/// # Arguments
///
/// * `path` - Path to the JSON file
///
/// # Returns
///
/// The parsed structure or an error if parsing/reading fails.
pub fn parse_structure_file(path: &Path) -> Result<Structure> {
    let json = std::fs::read_to_string(path)?;
    parse_structure_json(&json).map_err(|e| {
        if let FerroxError::JsonError { reason, .. } = e {
            FerroxError::JsonError {
                path: path.display().to_string(),
                reason,
            }
        } else {
            e
        }
    })
}

/// Parse multiple structures from JSON files matching a glob pattern.
///
/// # Arguments
///
/// * `pattern` - Glob pattern (e.g., "structures/*.json")
///
/// # Returns
///
/// Vector of (path, structure) pairs, or error if any file fails to parse.
pub fn parse_structures_glob(pattern: &str) -> Result<Vec<(String, Structure)>> {
    let paths: Vec<_> = glob::glob(pattern)
        .map_err(|e| FerroxError::JsonError {
            path: pattern.to_string(),
            reason: format!("Invalid glob pattern: {e}"),
        })?
        .filter_map(|r| r.ok())
        .collect();

    let mut results = Vec::with_capacity(paths.len());
    for path in paths {
        let structure = parse_structure_file(&path)?;
        results.push((path.display().to_string(), structure));
    }

    Ok(results)
}

/// Serialize a structure to pymatgen JSON format.
///
/// This produces JSON compatible with pymatgen's `Structure.from_dict()`.
///
/// # Arguments
///
/// * `structure` - The structure to serialize
///
/// # Returns
///
/// JSON string in pymatgen format.
pub fn structure_to_json(structure: &Structure) -> String {
    let m = structure.lattice.matrix();

    let sites: Vec<serde_json::Value> = structure
        .species
        .iter()
        .zip(structure.frac_coords.iter())
        .map(|(sp, fc)| {
            let mut species_entry = serde_json::json!({
                "element": sp.element.symbol()
            });
            if let Some(oxi) = sp.oxidation_state {
                species_entry["oxidation_state"] = serde_json::json!(oxi);
            }

            serde_json::json!({
                "species": [species_entry],
                "abc": [fc[0], fc[1], fc[2]]
            })
        })
        .collect();

    serde_json::json!({
        "@module": "pymatgen.core.structure",
        "@class": "Structure",
        "lattice": {
            "matrix": [
                [m[(0,0)], m[(0,1)], m[(0,2)]],
                [m[(1,0)], m[(1,1)], m[(1,2)]],
                [m[(2,0)], m[(2,1)], m[(2,2)]]
            ],
            "pbc": [true, true, true]
        },
        "sites": sites,
        "properties": {}
    })
    .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::element::Element;

    #[test]
    fn test_parse_simple_structure() {
        let json = r#"{
            "lattice": {"matrix": [[4,0,0],[0,4,0],[0,0,4]]},
            "sites": [
                {"species": [{"element": "Fe"}], "abc": [0,0,0]},
                {"species": [{"element": "Fe"}], "abc": [0.5,0.5,0.5]}
            ]
        }"#;

        let s = parse_structure_json(json).unwrap();
        assert_eq!(s.num_sites(), 2);
        assert_eq!(s.species[0].element, Element::Fe);
        assert_eq!(s.species[1].element, Element::Fe);
        assert!((s.lattice.volume() - 64.0).abs() < 1e-10);
    }

    #[test]
    fn test_parse_with_oxidation_states() {
        let json = r#"{
            "lattice": {"matrix": [[5.64,0,0],[0,5.64,0],[0,0,5.64]]},
            "sites": [
                {"species": [{"element": "Na", "oxidation_state": 1}], "abc": [0,0,0]},
                {"species": [{"element": "Cl", "oxidation_state": -1}], "abc": [0.5,0.5,0.5]}
            ]
        }"#;

        let s = parse_structure_json(json).unwrap();
        assert_eq!(s.species[0].oxidation_state, Some(1));
        assert_eq!(s.species[1].oxidation_state, Some(-1));
    }

    #[test]
    fn test_parse_oxidation_states_as_floats() {
        // Pymatgen serializes oxidation states as floats (e.g., 3.0 instead of 3)
        let json = r#"{
            "lattice": {"matrix": [[5.0,0,0],[0,5.0,0],[0,0,5.0]]},
            "sites": [
                {"species": [{"element": "Bi", "oxidation_state": 3.0}], "abc": [0,0,0]},
                {"species": [{"element": "Zr", "oxidation_state": 4.0}], "abc": [0.5,0.5,0.5]}
            ]
        }"#;

        let s = parse_structure_json(json).unwrap();
        assert_eq!(s.species[0].oxidation_state, Some(3));
        assert_eq!(s.species[1].oxidation_state, Some(4));
    }

    #[test]
    fn test_parse_oxidation_states_null() {
        // Test that null oxidation_state is handled correctly
        let json = r#"{
            "lattice": {"matrix": [[4,0,0],[0,4,0],[0,0,4]]},
            "sites": [
                {"species": [{"element": "Fe", "oxidation_state": null}], "abc": [0,0,0]}
            ]
        }"#;

        let s = parse_structure_json(json).unwrap();
        assert_eq!(s.species[0].oxidation_state, None);
    }

    #[test]
    fn test_parse_full_pymatgen_format() {
        // Test with all optional fields present
        let json = r#"{
            "@module": "pymatgen.core.structure",
            "@class": "Structure",
            "charge": 0,
            "lattice": {
                "matrix": [[3.84, 0, 0], [0, 3.84, 0], [0, 0, 3.84]],
                "pbc": [true, true, true]
            },
            "sites": [
                {"species": [{"element": "Cu", "occu": 1.0}], "abc": [0, 0, 0], "properties": {}}
            ],
            "properties": {}
        }"#;

        let s = parse_structure_json(json).unwrap();
        assert_eq!(s.num_sites(), 1);
        assert_eq!(s.species[0].element, Element::Cu);
    }

    #[test]
    fn test_parse_invalid_element() {
        let json = r#"{
            "lattice": {"matrix": [[4,0,0],[0,4,0],[0,0,4]]},
            "sites": [{"species": [{"element": "Xx"}], "abc": [0,0,0]}]
        }"#;

        let result = parse_structure_json(json);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.to_string().contains("Unknown element"));
    }

    #[test]
    fn test_parse_empty_species() {
        let json = r#"{
            "lattice": {"matrix": [[4,0,0],[0,4,0],[0,0,4]]},
            "sites": [{"species": [], "abc": [0,0,0]}]
        }"#;

        let result = parse_structure_json(json);
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.to_string().contains("no species"));
    }

    #[test]
    fn test_parse_invalid_json() {
        let json = "not valid json";
        let result = parse_structure_json(json);
        assert!(result.is_err());
    }

    #[test]
    fn test_structure_to_json_roundtrip() {
        let lattice = Lattice::cubic(5.64);
        let species = vec![Species::neutral(Element::Na), Species::neutral(Element::Cl)];
        let coords = vec![Vector3::new(0.0, 0.0, 0.0), Vector3::new(0.5, 0.5, 0.5)];
        let s1 = Structure::new(lattice, species, coords);

        let json = structure_to_json(&s1);
        let s2 = parse_structure_json(&json).unwrap();

        assert_eq!(s1.num_sites(), s2.num_sites());
        assert_eq!(s1.species[0].element, s2.species[0].element);
        assert_eq!(s1.species[1].element, s2.species[1].element);
        assert!((s1.lattice.volume() - s2.lattice.volume()).abs() < 1e-10);
    }

    #[test]
    fn test_parse_rocksalt() {
        // Full NaCl structure
        let json = r#"{
            "lattice": {"matrix": [[5.64,0,0],[0,5.64,0],[0,0,5.64]]},
            "sites": [
                {"species": [{"element": "Na"}], "abc": [0.0, 0.0, 0.0]},
                {"species": [{"element": "Na"}], "abc": [0.5, 0.5, 0.0]},
                {"species": [{"element": "Na"}], "abc": [0.5, 0.0, 0.5]},
                {"species": [{"element": "Na"}], "abc": [0.0, 0.5, 0.5]},
                {"species": [{"element": "Cl"}], "abc": [0.5, 0.0, 0.0]},
                {"species": [{"element": "Cl"}], "abc": [0.0, 0.5, 0.0]},
                {"species": [{"element": "Cl"}], "abc": [0.0, 0.0, 0.5]},
                {"species": [{"element": "Cl"}], "abc": [0.5, 0.5, 0.5]}
            ]
        }"#;

        let s = parse_structure_json(json).unwrap();
        assert_eq!(s.num_sites(), 8);

        // Check composition
        let comp = s.composition();
        assert_eq!(comp.reduced_formula(), "NaCl");
    }

    #[test]
    fn test_parse_oxidation_state_overflow() {
        // Oxidation states outside i8 range should error
        for oxi in [200, -200] {
            let json = format!(
                r#"{{"lattice": {{"matrix": [[4,0,0],[0,4,0],[0,0,4]]}},
                    "sites": [{{"species": [{{"element": "Fe", "oxidation_state": {oxi}}}], "abc": [0,0,0]}}]}}"#
            );
            let result = parse_structure_json(&json);
            assert!(result.is_err(), "oxi={oxi} should error");
            assert!(result.unwrap_err().to_string().contains("out of range"));
        }
    }

    #[test]
    fn test_parse_disordered_site() {
        // Multiple species per site (disordered) - should use first species
        let json = r#"{
            "lattice": {"matrix": [[4,0,0],[0,4,0],[0,0,4]]},
            "sites": [
                {"species": [
                    {"element": "Fe", "occu": 0.5},
                    {"element": "Co", "occu": 0.5}
                ], "abc": [0,0,0]}
            ]
        }"#;

        // Should parse successfully, using first species
        let s = parse_structure_json(json).unwrap();
        assert_eq!(s.num_sites(), 1);
        assert_eq!(s.species[0].element, Element::Fe);
    }

    #[test]
    fn test_parse_xyz_coords() {
        // Test parsing with xyz (Cartesian) coordinates
        let json = r#"{
            "lattice": {"matrix": [[4,0,0],[0,4,0],[0,0,4]]},
            "sites": [
                {"species": [{"element": "Fe"}], "xyz": [2, 2, 2], "abc": [0.5, 0.5, 0.5]}
            ]
        }"#;

        let s = parse_structure_json(json).unwrap();
        assert_eq!(s.num_sites(), 1);
        // Check fractional coords are used
        assert!((s.frac_coords[0][0] - 0.5).abs() < 1e-10);
    }

    #[test]
    fn test_parse_minimal_lattice() {
        // Lattice with only matrix (no pbc field)
        let json = r#"{
            "lattice": {"matrix": [[3,0,0],[0,3,0],[0,0,3]]},
            "sites": [{"species": [{"element": "Cu"}], "abc": [0,0,0]}]
        }"#;

        let s = parse_structure_json(json).unwrap();
        assert_eq!(s.num_sites(), 1);
        assert!((s.lattice.volume() - 27.0).abs() < 1e-10);
    }
}
