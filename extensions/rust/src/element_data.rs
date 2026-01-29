//! Extended element data loaded from JSON.
//!
//! This module loads additional element properties from the shared JSON file
//! at compile time, providing access to oxidation states, ionic radii, and
//! Shannon radii data.

use serde::Deserialize;
use std::collections::HashMap;
use std::sync::OnceLock;

/// Compile-time embedded JSON data (single source of truth shared with TypeScript).
const ELEMENT_DATA_JSON: &str = include_str!("../../../src/lib/element/data.json");

/// Shannon radius pair: crystal and ionic radii.
#[derive(Debug, Clone, Deserialize)]
pub struct ShannonRadiusPair {
    /// Crystal radius in Angstroms.
    pub crystal_radius: f64,
    /// Ionic radius in Angstroms.
    pub ionic_radius: f64,
}

/// Shannon radii structure: coordination -> spin -> radii.
pub type ShannonCoordination = HashMap<String, HashMap<String, ShannonRadiusPair>>;

/// Shannon radii for all oxidation states: oxidation_state -> coordination -> spin -> radii.
pub type ShannonRadii = HashMap<String, ShannonCoordination>;

/// Element data from JSON.
#[derive(Debug, Deserialize)]
pub struct ElementData {
    /// Atomic number (1-118).
    pub number: u8,
    /// Element symbol.
    pub symbol: String,
    /// Full element name.
    pub name: String,
    /// Atomic mass in atomic mass units.
    pub atomic_mass: f64,
    /// Periodic table row (1-10).
    pub row: u8,
    /// Periodic table column/group (1-18).
    pub column: u8,
    /// Periodic table period (1-7).
    pub period: u8,
    /// Element category.
    pub category: Option<String>,
    /// Atomic radius in Angstroms.
    pub atomic_radius: Option<f64>,
    /// Covalent radius in Angstroms.
    pub covalent_radius: Option<f64>,
    /// All known oxidation states.
    pub oxidation_states: Option<Vec<i8>>,
    /// Common oxidation states.
    pub common_oxidation_states: Option<Vec<i8>>,
    /// ICSD oxidation states.
    pub icsd_oxidation_states: Option<Vec<i8>>,
    /// Ionic radii by oxidation state (string keys like "2", "-1").
    pub ionic_radii: Option<HashMap<String, f64>>,
    /// Shannon radii (full nested structure).
    pub shannon_radii: Option<ShannonRadii>,
    /// Whether element is radioactive.
    pub radioactive: Option<bool>,
    /// Whether element is a metal.
    pub metal: Option<bool>,
    /// Whether element is a nonmetal.
    pub nonmetal: Option<bool>,
    /// Whether element is a metalloid.
    pub metalloid: Option<bool>,
}

/// Static storage for parsed element data.
static ELEMENT_DATA: OnceLock<Vec<ElementData>> = OnceLock::new();

/// Get all element data (parses JSON on first call).
pub fn get_all() -> &'static [ElementData] {
    ELEMENT_DATA.get_or_init(|| {
        serde_json::from_str(ELEMENT_DATA_JSON).expect("Failed to parse element data JSON")
    })
}

/// Get element data by atomic number (1-118).
pub fn get_by_atomic_number(z: u8) -> Option<&'static ElementData> {
    if !(1..=118).contains(&z) {
        return None;
    }
    get_all().get((z - 1) as usize)
}

/// Get element data by symbol.
pub fn get_by_symbol(symbol: &str) -> Option<&'static ElementData> {
    get_all()
        .iter()
        .find(|e| e.symbol.eq_ignore_ascii_case(symbol))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_data_loads() {
        let data = get_all();
        assert_eq!(data.len(), 118, "Should have 118 elements");
    }

    #[test]
    fn test_get_by_atomic_number() {
        // Hydrogen
        let h = get_by_atomic_number(1).expect("H should exist");
        assert_eq!(h.symbol, "H");
        assert_eq!(h.name, "Hydrogen");
        assert_eq!(h.number, 1);

        // Iron
        let fe = get_by_atomic_number(26).expect("Fe should exist");
        assert_eq!(fe.symbol, "Fe");
        assert_eq!(fe.name, "Iron");

        // Oganesson (last element)
        let og = get_by_atomic_number(118).expect("Og should exist");
        assert_eq!(og.symbol, "Og");

        // Invalid atomic numbers
        assert!(get_by_atomic_number(0).is_none());
        assert!(get_by_atomic_number(119).is_none());
    }

    #[test]
    fn test_get_by_symbol() {
        let fe = get_by_symbol("Fe").expect("Fe should exist");
        assert_eq!(fe.number, 26);

        // Case insensitive
        let fe_lower = get_by_symbol("fe").expect("fe should exist");
        assert_eq!(fe_lower.number, 26);

        // Unknown symbol
        assert!(get_by_symbol("Xx").is_none());
    }

    #[test]
    fn test_oxidation_states() {
        let fe = get_by_atomic_number(26).expect("Fe should exist");
        let oxi = fe
            .oxidation_states
            .as_ref()
            .expect("Fe should have oxidation states");
        assert!(oxi.contains(&2), "Fe should have +2 oxidation state");
        assert!(oxi.contains(&3), "Fe should have +3 oxidation state");

        let common = fe
            .common_oxidation_states
            .as_ref()
            .expect("Fe should have common oxidation states");
        assert!(common.contains(&2) || common.contains(&3));
    }

    #[test]
    fn test_ionic_radii() {
        let fe = get_by_atomic_number(26).expect("Fe should exist");
        let radii = fe.ionic_radii.as_ref().expect("Fe should have ionic radii");
        // Fe2+ should have an ionic radius
        assert!(radii.contains_key("2"), "Fe should have radius for +2");
    }

    #[test]
    fn test_shannon_radii() {
        let fe = get_by_atomic_number(26).expect("Fe should exist");
        let shannon = fe
            .shannon_radii
            .as_ref()
            .expect("Fe should have Shannon radii");

        // Fe2+ with octahedral coordination (VI) should have Shannon radius
        if let Some(oxi_2) = shannon.get("2") {
            assert!(
                oxi_2.contains_key("VI") || oxi_2.contains_key("IV"),
                "Fe2+ should have coordination data"
            );
        }
    }

    #[test]
    fn test_noble_gas_no_oxidation() {
        let he = get_by_atomic_number(2).expect("He should exist");
        // Noble gases typically have empty or limited oxidation states
        let oxi = he.oxidation_states.as_ref();
        assert!(
            oxi.is_none() || oxi.unwrap().is_empty(),
            "He should have no oxidation states"
        );
    }
}
