use once_cell::sync::Lazy;
use serde::Deserialize;
use std::collections::HashMap;

/// Minimal element data structure containing only fields used by the bonding algorithms.
/// All fields except `symbol` are optional to ensure robust deserialization even if
/// elements.json is missing or has null values for certain properties.
#[derive(Debug, Clone, Deserialize)]
struct ElementData {
    /// Element symbol (e.g., "H", "He", "Li")
    symbol: String,

    /// Covalent radius in Angstroms
    #[serde(default)]
    covalent_radius: Option<f64>,

    /// Electronegativity value
    #[serde(default)]
    electronegativity: Option<f64>,

    /// Pauling electronegativity (fallback if electronegativity is missing)
    #[serde(default)]
    electronegativity_pauling: Option<f64>,

    /// Whether the element is classified as a metal
    #[serde(default)]
    metal: Option<bool>,

    /// Whether the element is classified as a nonmetal
    #[serde(default)]
    nonmetal: Option<bool>,
}

#[derive(Debug, Clone)]
pub struct ElementProps {
    pub covalent_radius: Option<f64>,
    pub electronegativity: f64,
    pub is_metal: bool,
    pub is_nonmetal: bool,
}

static ELEMENT_DATA: Lazy<Vec<ElementData>> = Lazy::new(|| {
    const JSON_DATA: &str = include_str!("elements.json");
    serde_json::from_str(JSON_DATA).expect("Failed to parse elements.json")
});

fn load_element_data() -> &'static [ElementData] {
    &ELEMENT_DATA
}

pub fn get_covalent_radii() -> HashMap<String, f64> {
    load_element_data()
        .iter()
        .filter_map(|elem| elem.covalent_radius.map(|radius| (elem.symbol.clone(), radius)))
        .collect()
}

pub fn get_element_props() -> HashMap<String, ElementProps> {
    load_element_data()
        .iter()
        .map(|elem| {
            (
                elem.symbol.clone(),
                ElementProps {
                    covalent_radius: elem.covalent_radius,
                    electronegativity: elem.electronegativity
                        .or(elem.electronegativity_pauling)
                        .unwrap_or(0.0),
                    is_metal: elem.metal.unwrap_or(false),
                    is_nonmetal: elem.nonmetal.unwrap_or(false),
                },
            )
        })
        .collect()
}
