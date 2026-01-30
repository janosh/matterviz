//! Chemical species definitions.
//!
//! A species represents an element with an optional oxidation state,
//! e.g., Fe2+ or O2-.

use crate::element::Element;
use itertools::Itertools;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::HashMap;
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

    /// Get the ionic radius for this species' oxidation state.
    ///
    /// Returns `None` if no oxidation state is set or if no ionic radius
    /// data is available for the element/oxidation state combination.
    ///
    /// # Examples
    ///
    /// ```
    /// use ferrox::species::Species;
    /// use ferrox::element::Element;
    ///
    /// let fe2 = Species::new(Element::Fe, Some(2));
    /// let radius = fe2.ionic_radius();
    /// assert!(radius.is_some());
    /// ```
    pub fn ionic_radius(&self) -> Option<f64> {
        let oxi = self.oxidation_state?;
        self.element.ionic_radius(oxi)
    }

    /// Get the Shannon ionic radius for this species with specified coordination and spin.
    ///
    /// Shannon radii provide detailed ionic radii accounting for coordination number
    /// and spin state.
    ///
    /// # Arguments
    ///
    /// * `coordination` - Coordination number as Roman numeral (e.g., "VI" for octahedral)
    /// * `spin` - Spin state (e.g., "High Spin", "Low Spin", or "" for no spin)
    ///
    /// # Examples
    ///
    /// ```
    /// use ferrox::species::Species;
    /// use ferrox::element::Element;
    ///
    /// let fe2 = Species::new(Element::Fe, Some(2));
    /// let radius = fe2.shannon_ionic_radius("VI", "High Spin");
    /// ```
    pub fn shannon_ionic_radius(&self, coordination: &str, spin: &str) -> Option<f64> {
        let oxi = self.oxidation_state?;
        self.element.shannon_ionic_radius(oxi, coordination, spin)
    }

    /// Get the element's atomic radius.
    pub fn atomic_radius(&self) -> Option<f64> {
        self.element.atomic_radius()
    }

    /// Get the element's covalent radius.
    pub fn covalent_radius(&self) -> Option<f64> {
        self.element.covalent_radius()
    }

    /// Get the element's full name (e.g., "Iron" for Fe).
    pub fn name(&self) -> &'static str {
        self.element.name()
    }
}

impl PartialEq for Species {
    fn eq(&self, other: &Self) -> bool {
        self.element == other.element && self.oxidation_state == other.oxidation_state
    }
}

impl Eq for Species {}

impl PartialOrd for Species {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Species {
    /// Sort order matches pymatgen: electronegativity, then symbol, then oxidation state.
    fn cmp(&self, other: &Self) -> Ordering {
        // Electronegativity (None/NaN treated as infinity), then symbol, then oxidation state
        let en_self = self.electronegativity().unwrap_or(f64::INFINITY);
        let en_other = other.electronegativity().unwrap_or(f64::INFINITY);
        en_self
            .partial_cmp(&en_other)
            .unwrap_or(Ordering::Equal)
            .then_with(|| self.element.symbol().cmp(other.element.symbol()))
            .then_with(|| self.oxidation_state.cmp(&other.oxidation_state))
    }
}

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
    /// Site-level properties (label, magmom, forces, etc.).
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub properties: HashMap<String, serde_json::Value>,
}

impl SiteOccupancy {
    /// Create a new site occupancy from species-occupancy pairs.
    ///
    /// # Panics
    ///
    /// Panics if `species` is empty or if any occupancy is not finite or positive.
    ///
    /// # Note
    ///
    /// This constructor allows occupancies > 1.0 for flexibility. JSON parsing
    /// in `io.rs` applies stricter validation (0.0 < occu <= 1.0).
    pub fn new(species: Vec<(Species, f64)>) -> Self {
        Self::with_properties(species, HashMap::new())
    }

    /// Create a new site occupancy with properties.
    ///
    /// # Panics
    ///
    /// Panics if `species` is empty or if any occupancy is not finite or positive.
    pub fn with_properties(
        species: Vec<(Species, f64)>,
        properties: HashMap<String, serde_json::Value>,
    ) -> Self {
        assert!(
            !species.is_empty(),
            "SiteOccupancy requires at least one species"
        );
        assert!(
            species.iter().all(|(_, occ)| occ.is_finite() && *occ > 0.0),
            "SiteOccupancy occupancies must be finite and positive"
        );
        Self {
            species,
            properties,
        }
    }

    /// Create an ordered site with a single species at full occupancy.
    pub fn ordered(species: Species) -> Self {
        Self {
            species: vec![(species, 1.0)],
            properties: HashMap::new(),
        }
    }

    /// Check if this is an ordered site (single species).
    ///
    /// Returns `true` if there is exactly one species, even if it has partial
    /// occupancy (vacancy). A site with Fe at 0.8 occupancy is still "ordered"
    /// in the crystallographic sense - the disorder refers to mixed species,
    /// not vacancies.
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

    /// Get human-readable species string.
    ///
    /// For ordered sites: returns the species string (e.g., "Fe" or "Fe2+")
    /// For disordered sites: returns sorted species with occupancies
    /// (e.g., "Fe:0.5, Co:0.5", sorted by electronegativity then symbol then oxidation state)
    ///
    /// This matches pymatgen's `species_string` property format and sorting order.
    pub fn species_string(&self) -> String {
        if self.is_ordered() {
            self.dominant_species().to_string()
        } else {
            self.species
                .iter()
                .sorted_by(|(sp_a, _), (sp_b, _)| sp_a.cmp(sp_b))
                .map(|(sp, occ)| format!("{sp}:{occ}"))
                .join(", ")
        }
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
        // Note: "X", "Xx", "D", "T" are now valid pseudo-elements
        let invalid_cases = [
            ("Zzz", "truly unknown element"),
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
    fn test_pseudo_elements() {
        use crate::element::Element;

        // Pseudo-elements should parse correctly
        let pseudo_cases = [
            ("X", Element::Dummy),
            ("Xx", Element::Dummy),
            ("D", Element::D),
            ("T", Element::T),
            ("Dummy", Element::Dummy),
            ("Vac", Element::Dummy),
        ];

        for (input, expected_elem) in pseudo_cases {
            let sp = Species::from_string(input)
                .unwrap_or_else(|| panic!("Failed to parse pseudo-element: {input}"));
            assert_eq!(sp.element, expected_elem, "element mismatch for '{input}'");
            assert_eq!(sp.oxidation_state, None);
        }

        // Pseudo-elements with oxidation states
        let sp = Species::from_string("D+").unwrap();
        assert_eq!(sp.element, Element::D);
        assert_eq!(sp.oxidation_state, Some(1));
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

    #[test]
    fn test_species_ordering() {
        // Species Ord matches pymatgen: electronegativity, then symbol, then oxidation state

        // Different electronegativity: Fe (1.83) < Co (1.88) < O (3.44)
        let fe = Species::neutral(Element::Fe);
        let co = Species::neutral(Element::Co);
        let o = Species::neutral(Element::O);
        assert!(fe < co);
        assert!(co < o);

        // Same element, different oxidation: sorted numerically
        let fe2 = Species::new(Element::Fe, Some(2));
        let fe3 = Species::new(Element::Fe, Some(3));
        assert!(fe2 < fe3);

        // Negative oxidation states: -2 < -1
        let o2_minus = Species::new(Element::O, Some(-2));
        let o1_minus = Species::new(Element::O, Some(-1));
        assert!(o2_minus < o1_minus);

        // Species sorting is stable and deterministic
        let mut species = [
            Species::neutral(Element::Co),
            Species::neutral(Element::Fe),
            Species::new(Element::Fe, Some(3)),
            Species::new(Element::Fe, Some(2)),
        ];
        species.sort();
        assert_eq!(
            species.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
            vec!["Fe", "Fe2+", "Fe3+", "Co"]
        );

        // Noble gases (no electronegativity) sort last, then by symbol
        let he = Species::neutral(Element::He);
        let ne = Species::neutral(Element::Ne);
        assert!(o < he); // O has EN, He doesn't
        assert!(he < ne); // Both no EN, sorted alphabetically by symbol
    }

    #[test]
    fn test_species_radii_and_properties() {
        let fe = Species::neutral(Element::Fe);
        let fe2 = Species::new(Element::Fe, Some(2));
        let fe3 = Species::new(Element::Fe, Some(3));
        let o2minus = Species::new(Element::O, Some(-2));

        // Neutral species properties
        assert!(fe.atomic_radius().is_some(), "Fe should have atomic radius");
        assert!(
            fe.covalent_radius().is_some(),
            "Fe should have covalent radius"
        );
        assert_eq!(fe.name(), "Iron");
        assert!(
            fe.ionic_radius().is_none(),
            "Neutral species has no ionic radius"
        );
        assert!(fe.shannon_ionic_radius("VI", "High Spin").is_none());

        // Ionic species should have ionic radii
        for (species, label) in [(fe2, "Fe2+"), (fe3, "Fe3+"), (o2minus, "O2-")] {
            let r = species.ionic_radius();
            assert!(r.is_some(), "{label} should have ionic radius");
            assert!(
                r.unwrap() > 0.0 && r.unwrap() < 2.0,
                "{label} radius reasonable"
            );
        }

        // Shannon radius API (may or may not have data for exact coordination/spin)
        if let Some(r) = fe2.shannon_ionic_radius("VI", "High Spin") {
            assert!(r > 0.0 && r < 2.0, "Shannon radius should be reasonable");
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
    fn test_site_occupancy_equal_occupancy_deterministic() {
        // When occupancies are equal, result should be deterministic across calls
        let so = SiteOccupancy::new(vec![
            (Species::neutral(Element::Fe), 0.5),
            (Species::neutral(Element::Co), 0.5),
        ]);
        let dom1 = so.dominant_species().element;
        let dom2 = so.dominant_species().element;
        assert_eq!(dom1, dom2, "dominant_species should be deterministic");
        assert!(dom1 == Element::Fe || dom1 == Element::Co);
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
    #[should_panic(expected = "SiteOccupancy occupancies must be finite and positive")]
    fn test_site_occupancy_negative_panics() {
        SiteOccupancy::new(vec![(Species::neutral(Element::Fe), -0.5)]);
    }

    #[test]
    #[should_panic(expected = "SiteOccupancy occupancies must be finite and positive")]
    fn test_site_occupancy_nan_panics() {
        SiteOccupancy::new(vec![(Species::neutral(Element::Fe), f64::NAN)]);
    }

    #[test]
    #[should_panic(expected = "SiteOccupancy occupancies must be finite and positive")]
    fn test_site_occupancy_infinity_panics() {
        SiteOccupancy::new(vec![(Species::neutral(Element::Fe), f64::INFINITY)]);
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
    fn test_species_string() {
        // Ordered sites (single species)
        for (sp, expected) in [
            (Species::neutral(Element::Fe), "Fe"),
            (Species::new(Element::Fe, Some(2)), "Fe2+"),
            (Species::new(Element::O, Some(-2)), "O2-"),
            (Species::neutral(Element::Dummy), "X"),
        ] {
            assert_eq!(SiteOccupancy::ordered(sp).species_string(), expected);
        }

        // Partial occupancy is still "ordered"
        let partial = SiteOccupancy::new(vec![(Species::neutral(Element::Fe), 0.8)]);
        assert!(partial.is_ordered());
        assert_eq!(partial.species_string(), "Fe");

        // Disordered: sorted by electronegativity, then symbol, then oxidation state
        // Format matches pymatgen exactly
        let cases: Vec<(Vec<(Species, f64)>, &str)> = vec![
            // Fe (1.83) < Co (1.88)
            (
                vec![
                    (Species::neutral(Element::Fe), 0.5),
                    (Species::neutral(Element::Co), 0.5),
                ],
                "Fe:0.5, Co:0.5",
            ),
            // Zn (1.65) < Fe (1.83) < Co (1.88)
            (
                vec![
                    (Species::neutral(Element::Zn), 0.2),
                    (Species::neutral(Element::Fe), 0.5),
                    (Species::neutral(Element::Co), 0.3),
                ],
                "Zn:0.2, Fe:0.5, Co:0.3",
            ),
            // Same element, sorted by oxidation state: 2 < 3
            (
                vec![
                    (Species::new(Element::Fe, Some(3)), 0.4),
                    (Species::new(Element::Fe, Some(2)), 0.6),
                ],
                "Fe2+:0.6, Fe3+:0.4",
            ),
            // Negative oxidation states: -2 < -1
            (
                vec![
                    (Species::new(Element::O, Some(-2)), 0.5),
                    (Species::new(Element::O, Some(-1)), 0.5),
                ],
                "O2-:0.5, O-:0.5",
            ),
            // Al (1.61) < Fe (1.83)
            (
                vec![
                    (Species::new(Element::Fe, Some(3)), 0.5),
                    (Species::new(Element::Al, Some(3)), 0.5),
                ],
                "Al3+:0.5, Fe3+:0.5",
            ),
            // High entropy alloy: Mn (1.55) < Cr (1.66) < Fe (1.83) < Co (1.88) < Ni (1.91)
            (
                vec![
                    (Species::neutral(Element::Fe), 0.2),
                    (Species::neutral(Element::Co), 0.2),
                    (Species::neutral(Element::Ni), 0.2),
                    (Species::neutral(Element::Cr), 0.2),
                    (Species::neutral(Element::Mn), 0.2),
                ],
                "Mn:0.2, Cr:0.2, Fe:0.2, Co:0.2, Ni:0.2",
            ),
        ];
        for (species, expected) in cases {
            assert_eq!(SiteOccupancy::new(species).species_string(), expected);
        }
    }
}
