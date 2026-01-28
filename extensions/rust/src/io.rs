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
///
/// Validates that the value fits within i32 range before conversion to avoid
/// undefined behavior from overflow.
fn deserialize_oxidation_state<'de, D>(
    deserializer: D,
) -> std::result::Result<Option<i32>, D::Error>
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
                // Check i64 fits in i32 before converting
                if int_val < i32::MIN as i64 || int_val > i32::MAX as i64 {
                    return Err(D::Error::custom(format!(
                        "oxidation_state {int_val} overflows i32 range"
                    )));
                }
                Ok(Some(int_val as i32))
            } else if let Some(float_val) = n.as_f64() {
                // Check float is finite and within i32 range before converting
                let rounded = float_val.round();
                if !rounded.is_finite() || rounded < i32::MIN as f64 || rounded > i32::MAX as f64 {
                    return Err(D::Error::custom(format!(
                        "oxidation_state {float_val} overflows i32 range"
                    )));
                }
                Ok(Some(rounded as i32))
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
/// # Limitations
///
/// - **Disordered sites**: Sites with multiple species (partial occupancy) use only
///   the first species. Full disorder support is not yet implemented.
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
    let mat = &parsed.lattice.matrix;
    let matrix = nalgebra::Matrix3::new(
        mat[0][0], mat[0][1], mat[0][2], mat[1][0], mat[1][1], mat[1][2], mat[2][0], mat[2][1],
        mat[2][2],
    );
    let mut lattice = Lattice::new(matrix);
    lattice.pbc = parsed.lattice.pbc;

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

        // TODO: Add proper disordered site support with occupancy tracking.
        // Currently uses only the first species, losing partial occupancy information.
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

    // Extract properties from JSON (convert Value to HashMap)
    let properties = match parsed.properties {
        serde_json::Value::Object(map) => map.into_iter().collect(),
        serde_json::Value::Null => std::collections::HashMap::new(),
        _ => std::collections::HashMap::new(),
    };

    Structure::try_new_with_properties(lattice, species, frac_coords, properties)
}

/// Serialize a structure to pymatgen's JSON format.
///
/// Produces JSON compatible with pymatgen's `Structure.from_dict()`.
///
/// # Arguments
///
/// * `structure` - The structure to serialize
///
/// # Returns
///
/// JSON string in pymatgen format.
pub fn structure_to_pymatgen_json(structure: &Structure) -> String {
    use serde_json::{Value, json};

    // Build lattice
    let mat = structure.lattice.matrix();
    let lattice = json!({
        "matrix": [
            [mat[(0, 0)], mat[(0, 1)], mat[(0, 2)]],
            [mat[(1, 0)], mat[(1, 1)], mat[(1, 2)]],
            [mat[(2, 0)], mat[(2, 1)], mat[(2, 2)]]
        ],
        "pbc": structure.lattice.pbc
    });

    // Build sites
    let sites: Vec<Value> = structure
        .species
        .iter()
        .zip(structure.frac_coords.iter())
        .map(|(sp, coord)| {
            let mut species_entry = json!({
                "element": sp.element.symbol(),
                "occu": 1.0
            });
            if let Some(oxi) = sp.oxidation_state {
                species_entry["oxidation_state"] = json!(oxi);
            }

            json!({
                "species": [species_entry],
                "abc": [coord.x, coord.y, coord.z],
                "properties": {}
            })
        })
        .collect();

    // Build structure properties
    let properties: serde_json::Map<String, Value> =
        structure.properties.clone().into_iter().collect();

    // Build full structure
    let result = json!({
        "@module": "pymatgen.core.structure",
        "@class": "Structure",
        "lattice": lattice,
        "sites": sites,
        "properties": properties
    });

    result.to_string()
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
/// File access errors (permissions, broken symlinks) during glob iteration
/// are logged as warnings but do not cause the function to fail.
pub fn parse_structures_glob(pattern: &str) -> Result<Vec<(String, Structure)>> {
    let paths: Vec<_> = glob::glob(pattern)
        .map_err(|e| FerroxError::JsonError {
            path: pattern.to_string(),
            reason: format!("Invalid glob pattern: {e}"),
        })?
        .filter_map(|result| match result {
            Ok(path) => Some(path),
            Err(err) => {
                // Log glob errors (permissions, broken symlinks, etc.) for debugging
                tracing::warn!("Glob iteration error: {err}");
                None
            }
        })
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
/// Alias for [`structure_to_pymatgen_json`] for backwards compatibility.
#[inline]
pub fn structure_to_json(structure: &Structure) -> String {
    structure_to_pymatgen_json(structure)
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
        assert_eq!(s1.lattice.pbc, s2.lattice.pbc);
    }

    #[test]
    fn test_structure_to_json_preserves_pbc() {
        // Test non-standard PBC (e.g., slab with vacuum in z-direction)
        let mut lattice = Lattice::cubic(10.0);
        lattice.pbc = [true, true, false]; // Non-periodic in z
        let species = vec![Species::neutral(Element::Si)];
        let coords = vec![Vector3::new(0.5, 0.5, 0.5)];
        let s1 = Structure::new(lattice, species, coords);

        let json = structure_to_json(&s1);
        assert!(
            json.contains(r#""pbc":[true,true,false]"#),
            "JSON should contain pbc: {json}"
        );

        let s2 = parse_structure_json(&json).unwrap();
        assert_eq!(
            s2.lattice.pbc,
            [true, true, false],
            "PBC should be preserved in roundtrip"
        );
    }

    #[test]
    fn test_structure_to_json_preserves_properties() {
        // Test that properties survive JSON round-trip
        let json_with_props = r#"{
            "lattice": {"matrix": [[5.0,0,0],[0,5.0,0],[0,0,5.0]]},
            "sites": [{"species": [{"element": "Fe"}], "abc": [0.0, 0.0, 0.0]}],
            "properties": {"energy": -3.5, "source": "dft", "tags": ["test", "example"]}
        }"#;

        let s1 = parse_structure_json(json_with_props).unwrap();
        assert_eq!(s1.properties.len(), 3);
        assert_eq!(s1.properties["energy"], serde_json::json!(-3.5));
        assert_eq!(s1.properties["source"], serde_json::json!("dft"));

        // Round-trip through JSON
        let json_out = structure_to_json(&s1);
        let s2 = parse_structure_json(&json_out).unwrap();

        assert_eq!(s2.properties.len(), 3);
        assert_eq!(s2.properties["energy"], serde_json::json!(-3.5));
        assert_eq!(s2.properties["source"], serde_json::json!("dft"));
        assert_eq!(
            s2.properties["tags"],
            serde_json::json!(["test", "example"])
        );
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
    fn test_parse_oxidation_state_overflow_i8() {
        // Oxidation states outside i8 range should error (after successful parsing)
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
    fn test_parse_oxidation_state_overflow_i32() {
        // Float values that would overflow i32 should error during deserialization
        for oxi in ["3e10", "-3e10"] {
            let json = format!(
                r#"{{"lattice": {{"matrix": [[4,0,0],[0,4,0],[0,0,4]]}},
                    "sites": [{{"species": [{{"element": "Fe", "oxidation_state": {oxi}}}], "abc": [0,0,0]}}]}}"#
            );
            let result = parse_structure_json(&json);
            assert!(result.is_err(), "oxi={oxi} should error");
            assert!(
                result.unwrap_err().to_string().contains("overflow"),
                "Error for oxi={oxi} should mention overflow"
            );
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
