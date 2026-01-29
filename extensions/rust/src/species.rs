//! Chemical species definitions.
//!
//! A species represents an element with an optional oxidation state,
//! e.g., Fe2+ or O2-.

use crate::element::Element;
use serde::{Deserialize, Serialize};
use std::fmt;
use std::hash::{Hash, Hasher};

/// A chemical species (element + optional oxidation state).
///
/// # Examples
///
/// ```
/// use ferrox::species::Species;
/// use ferrox::element::Element;
///
/// // Neutral iron
/// let fe = Species::new(Element::Fe, None);
/// assert_eq!(fe.to_string(), "Fe");
///
/// // Iron(II)
/// let fe2 = Species::new(Element::Fe, Some(2));
/// assert_eq!(fe2.to_string(), "Fe2+");
///
/// // Oxide ion
/// let o2 = Species::new(Element::O, Some(-2));
/// assert_eq!(o2.to_string(), "O2-");
/// ```
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
pub struct Species {
    /// The chemical element.
    pub element: Element,
    /// The oxidation state, if known.
    pub oxidation_state: Option<i8>,
}

impl Species {
    /// Create a new species.
    ///
    /// # Arguments
    ///
    /// * `element` - The chemical element
    /// * `oxidation_state` - Optional oxidation state (e.g., +2, -1)
    pub fn new(element: Element, oxidation_state: Option<i8>) -> Self {
        Self {
            element,
            oxidation_state,
        }
    }

    /// Create a neutral species (no oxidation state).
    pub fn neutral(element: Element) -> Self {
        Self::new(element, None)
    }

    /// Parse a species from a string like "Fe2+" or "O2-".
    ///
    /// Supported formats:
    /// - "Fe" - neutral element
    /// - "Fe2+" - element with positive oxidation state
    /// - "O2-" - element with negative oxidation state
    /// - "Na+" - element with +1 oxidation state
    /// - "Cl-" - element with -1 oxidation state
    ///
    /// # Examples
    ///
    /// ```
    /// use ferrox::species::Species;
    /// use ferrox::element::Element;
    ///
    /// let fe2 = Species::from_string("Fe2+").unwrap();
    /// assert_eq!(fe2.element, Element::Fe);
    /// assert_eq!(fe2.oxidation_state, Some(2));
    ///
    /// let o = Species::from_string("O").unwrap();
    /// assert_eq!(o.element, Element::O);
    /// assert_eq!(o.oxidation_state, None);
    /// ```
    pub fn from_string(input: &str) -> Option<Self> {
        let input = input.trim();
        if input.is_empty() {
            return None;
        }

        // Check if there's a sign at the end
        let last_char = input.chars().last()?;
        if last_char != '+' && last_char != '-' {
            // No oxidation state, just element
            let element = Element::from_symbol(input)?;
            return Some(Self::new(element, None));
        }

        // Has a sign - find where the number starts
        let sign: i8 = if last_char == '+' { 1 } else { -1 };
        let without_sign = &input[..input.len() - 1];

        // Find where digits end (searching from the end)
        let mut digit_start = without_sign.len();
        for (idx, ch) in without_sign.char_indices().rev() {
            if ch.is_ascii_digit() {
                digit_start = idx;
            } else {
                break;
            }
        }

        let symbol = &without_sign[..digit_start];
        let element = Element::from_symbol(symbol)?;

        let oxi_state = if digit_start < without_sign.len() {
            // There's a number
            let num_str = &without_sign[digit_start..];
            let num: i8 = num_str.parse().ok()?;
            Some(num * sign)
        } else {
            // Just the sign, means +1 or -1
            Some(sign)
        };

        Some(Self::new(element, oxi_state))
    }

    /// Get the element's electronegativity.
    pub fn electronegativity(&self) -> Option<f64> {
        self.element.electronegativity()
    }
}

impl PartialEq for Species {
    fn eq(&self, other: &Self) -> bool {
        self.element == other.element && self.oxidation_state == other.oxidation_state
    }
}

impl Eq for Species {}

impl Hash for Species {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.element.hash(state);
        self.oxidation_state.hash(state);
    }
}

impl fmt::Display for Species {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.element.symbol())?;
        if let Some(oxi) = self.oxidation_state {
            let abs_oxi = oxi.unsigned_abs(); // Safe for all i8 values including -128
            let sign = if oxi >= 0 { '+' } else { '-' };
            if abs_oxi == 1 {
                write!(f, "{sign}")?;
            } else {
                write!(f, "{abs_oxi}{sign}")?;
            }
        }
        Ok(())
    }
}

impl From<Element> for Species {
    fn from(element: Element) -> Self {
        Self::neutral(element)
    }
}

/// A site with potentially multiple species (partial occupancy).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SiteOccupancy {
    /// Species with their occupancies.
    pub species: Vec<(Species, f64)>,
}

impl SiteOccupancy {
    /// Create a new site occupancy from species-occupancy pairs.
    ///
    /// # Panics
    ///
    /// Panics if `species` is empty.
    pub fn new(species: Vec<(Species, f64)>) -> Self {
        assert!(
            !species.is_empty(),
            "SiteOccupancy requires at least one species"
        );
        Self { species }
    }

    /// Create an ordered site with a single species at full occupancy.
    pub fn ordered(species: Species) -> Self {
        Self {
            species: vec![(species, 1.0)],
        }
    }

    /// Check if this is an ordered site (single species).
    pub fn is_ordered(&self) -> bool {
        self.species.len() == 1
    }

    /// Get the dominant species (highest occupancy).
    ///
    /// Uses total ordering for f64 comparison (NaN is treated as less than all other values).
    pub fn dominant_species(&self) -> &Species {
        self.species
            .iter()
            .max_by(|a, b| a.1.total_cmp(&b.1))
            .map(|(sp, _)| sp)
            .expect("SiteOccupancy must have at least one species")
    }

    /// Get the total occupancy.
    pub fn total_occupancy(&self) -> f64 {
        self.species.iter().map(|(_, occ)| occ).sum()
    }
}

impl From<Species> for SiteOccupancy {
    fn from(species: Species) -> Self {
        Self::ordered(species)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_constructors() {
        // Species::new with oxidation state
        let fe2 = Species::new(Element::Fe, Some(2));
        assert_eq!(fe2.element, Element::Fe);
        assert_eq!(fe2.oxidation_state, Some(2));

        // Species::neutral
        let fe = Species::neutral(Element::Fe);
        assert_eq!(fe.element, Element::Fe);
        assert_eq!(fe.oxidation_state, None);

        // From<Element> trait
        let cu: Species = Element::Cu.into();
        assert_eq!(cu.element, Element::Cu);
        assert_eq!(cu.oxidation_state, None);

        // Extreme oxidation states (valid for i8)
        let high_oxi = Species::new(Element::Os, Some(8)); // Os can be +8
        assert_eq!(high_oxi.oxidation_state, Some(8));
        let neg_oxi = Species::new(Element::N, Some(-3)); // N can be -3
        assert_eq!(neg_oxi.oxidation_state, Some(-3));
    }

    #[test]
    fn test_from_string_and_display() {
        // Comprehensive parsing and display tests
        // (input, expected_element, expected_oxi, expected_display)
        let cases: &[(&str, Element, Option<i8>, &str)] = &[
            // Neutral elements
            ("Fe", Element::Fe, None, "Fe"),
            ("Mg", Element::Mg, None, "Mg"),
            ("Cu", Element::Cu, None, "Cu"),
            // Common positive oxidation states
            ("Na+", Element::Na, Some(1), "Na+"),
            ("Ca2+", Element::Ca, Some(2), "Ca2+"),
            ("Fe2+", Element::Fe, Some(2), "Fe2+"),
            ("Fe3+", Element::Fe, Some(3), "Fe3+"),
            ("Al3+", Element::Al, Some(3), "Al3+"),
            ("Ti4+", Element::Ti, Some(4), "Ti4+"),
            ("Mn7+", Element::Mn, Some(7), "Mn7+"),
            // Common negative oxidation states
            ("Cl-", Element::Cl, Some(-1), "Cl-"),
            ("O2-", Element::O, Some(-2), "O2-"),
            ("N3-", Element::N, Some(-3), "N3-"),
            ("S2-", Element::S, Some(-2), "S2-"),
            // Edge cases: single-letter elements
            ("H", Element::H, None, "H"),
            ("H+", Element::H, Some(1), "H+"),
            ("O", Element::O, None, "O"),
            // Two-letter symbols with oxidation states
            ("Zn2+", Element::Zn, Some(2), "Zn2+"),
            ("Pb2+", Element::Pb, Some(2), "Pb2+"),
            ("Pb4+", Element::Pb, Some(4), "Pb4+"),
        ];

        for (input, elem, oxi, display) in cases {
            let sp =
                Species::from_string(input).unwrap_or_else(|| panic!("Failed to parse: {input}"));
            assert_eq!(sp.element, *elem, "element mismatch for '{input}'");
            assert_eq!(sp.oxidation_state, *oxi, "oxi mismatch for '{input}'");
            assert_eq!(sp.to_string(), *display, "display mismatch for '{input}'");
        }
    }

    #[test]
    fn test_from_string_errors() {
        // Invalid inputs should return None
        let invalid_cases = [
            ("Xx", "unknown element"),
            ("InvalidElement", "long invalid string"),
            ("", "empty string"),
            ("   ", "whitespace only"),
            ("+", "just plus sign"),
            ("-", "just minus sign"),
            ("2+Fe", "number before element"),
            ("++", "double plus"),
            ("--", "double minus"),
            ("Fe++", "double plus after element"),
            ("123", "just numbers"),
            ("Fe2", "number without sign"),
        ];

        for (input, desc) in invalid_cases {
            assert!(
                Species::from_string(input).is_none(),
                "'{input}' ({desc}) should return None"
            );
        }
    }

    #[test]
    fn test_equality_and_hashing() {
        use std::collections::HashSet;

        let fe2a = Species::new(Element::Fe, Some(2));
        let fe2b = Species::new(Element::Fe, Some(2));
        let fe3 = Species::new(Element::Fe, Some(3));
        let fe_neutral = Species::neutral(Element::Fe);
        let cu2 = Species::new(Element::Cu, Some(2));

        // Same element and oxidation state are equal
        assert_eq!(fe2a, fe2b);

        // Different oxidation state -> not equal
        assert_ne!(fe2a, fe3);
        assert_ne!(fe2a, fe_neutral);
        assert_ne!(fe3, fe_neutral);

        // Different element -> not equal
        assert_ne!(fe2a, cu2);

        // Hash consistency: equal species hash to same value
        let mut set = HashSet::new();
        set.insert(fe2a);
        assert!(set.contains(&fe2b), "Equal species should have same hash");
        assert!(
            !set.contains(&fe3),
            "Different species should have different hash"
        );
    }

    #[test]
    fn test_electronegativity() {
        // Electronegativity comes from element, not affected by oxidation state
        let test_cases = [
            (Element::Fe, 1.83),
            (Element::O, 3.44),
            (Element::F, 3.98), // Most electronegative
            (Element::Na, 0.93),
            (Element::Cs, 0.79), // Least electronegative metal
        ];

        for (elem, expected) in test_cases {
            let neutral = Species::neutral(elem);
            let charged = Species::new(elem, Some(2));

            let en_neutral = neutral.electronegativity().unwrap();
            let en_charged = charged.electronegativity().unwrap();

            assert!(
                (en_neutral - expected).abs() < 0.01,
                "{elem:?} EN {en_neutral} != expected {expected}"
            );
            assert_eq!(
                en_neutral, en_charged,
                "Oxidation state should not affect electronegativity"
            );
        }

        // Noble gases have no electronegativity
        for elem in [Element::He, Element::Ne, Element::Ar] {
            assert!(
                Species::neutral(elem).electronegativity().is_none(),
                "{elem:?} should have no electronegativity"
            );
        }
    }

    // =========================================================================
    // SiteOccupancy tests
    // =========================================================================

    #[test]
    fn test_site_occupancy_ordered() {
        let so = SiteOccupancy::ordered(Species::neutral(Element::Fe));
        assert!(so.is_ordered());
        assert_eq!(so.species.len(), 1);
        assert!((so.total_occupancy() - 1.0).abs() < 1e-10);
        assert_eq!(so.dominant_species().element, Element::Fe);
    }

    #[test]
    fn test_site_occupancy_disordered() {
        let so = SiteOccupancy::new(vec![
            (Species::neutral(Element::Fe), 0.6),
            (Species::neutral(Element::Co), 0.4),
        ]);
        assert!(!so.is_ordered());
        assert_eq!(so.species.len(), 2);
        assert!((so.total_occupancy() - 1.0).abs() < 1e-10);
        // Fe has higher occupancy, so it's dominant
        assert_eq!(so.dominant_species().element, Element::Fe);
    }

    #[test]
    fn test_site_occupancy_dominant_with_equal_occupancy() {
        // When occupancies are equal, should return one deterministically
        let so = SiteOccupancy::new(vec![
            (Species::neutral(Element::Fe), 0.5),
            (Species::neutral(Element::Co), 0.5),
        ]);
        // Should not panic, should return one of them
        let dominant = so.dominant_species();
        assert!(dominant.element == Element::Fe || dominant.element == Element::Co);
    }

    #[test]
    fn test_site_occupancy_from_species() {
        let sp = Species::neutral(Element::Cu);
        let so: SiteOccupancy = sp.into();
        assert!(so.is_ordered());
        assert_eq!(so.dominant_species().element, Element::Cu);
    }

    #[test]
    #[should_panic(expected = "SiteOccupancy requires at least one species")]
    fn test_site_occupancy_empty_panics() {
        SiteOccupancy::new(vec![]);
    }

    #[test]
    fn test_site_occupancy_partial_vacancy() {
        // Site with partial vacancy (total occupancy < 1.0)
        let so = SiteOccupancy::new(vec![(Species::neutral(Element::Fe), 0.8)]);
        assert!(so.is_ordered()); // Only one species, so "ordered"
        assert!((so.total_occupancy() - 0.8).abs() < 1e-10);
    }

    #[test]
    fn test_site_occupancy_partial_total_multiple_species() {
        // Multiple species with partial occupancy not summing to 1.0
        let so = SiteOccupancy::new(vec![
            (Species::neutral(Element::Fe), 0.3),
            (Species::neutral(Element::Co), 0.4),
        ]);
        assert!(!so.is_ordered());
        assert!(
            (so.total_occupancy() - 0.7).abs() < 1e-10,
            "Total occupancy should be 0.7, got {}",
            so.total_occupancy()
        );
    }

    #[test]
    fn test_site_occupancy_dominant_deterministic() {
        // When occupancies are equal, result should be deterministic across calls
        let so = SiteOccupancy::new(vec![
            (Species::neutral(Element::Fe), 0.5),
            (Species::neutral(Element::Co), 0.5),
        ]);
        let dom1 = so.dominant_species().element;
        let dom2 = so.dominant_species().element;
        assert_eq!(dom1, dom2, "dominant_species should be deterministic");
    }

    #[test]
    fn test_site_occupancy_full_occupancy_check() {
        // Verify total_occupancy() works for full occupancy
        let so = SiteOccupancy::new(vec![
            (Species::neutral(Element::Fe), 0.5),
            (Species::neutral(Element::Co), 0.5),
        ]);
        assert!(
            (so.total_occupancy() - 1.0).abs() < 1e-10,
            "Total occupancy should be 1.0"
        );
    }
}
