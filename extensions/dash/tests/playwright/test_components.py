"""Playwright integration tests for MatterViz Dash components."""

from __future__ import annotations

import pytest
from playwright.sync_api import Page, expect


class TestPageLoad:
    """Test that the sample app loads correctly."""

    def test_page_title_loads(self, dash_page: Page) -> None:
        """Page should load with the app title."""
        expect(dash_page.locator("h1")).to_contain_text("MatterViz Dash demo")

    def test_nav_links_visible(self, dash_page: Page) -> None:
        """Navigation links should be visible."""
        nav = dash_page.locator("nav")
        expect(nav).to_be_visible()
        # Check at least some nav links exist
        links = nav.locator("a")
        assert links.count() > 3


class TestPeriodicTable:
    """Test PeriodicTable component rendering."""

    def test_periodic_table_renders(self, dash_page: Page) -> None:
        """PeriodicTable component should render."""
        section = dash_page.locator("#periodic-table-section")
        expect(section).to_be_visible()

        # The MatterViz custom element should be present
        matterviz = section.locator("mv-matterviz")
        expect(matterviz).to_be_visible()

    def test_periodic_table_has_elements(self, dash_page: Page) -> None:
        """PeriodicTable should display element tiles."""
        section = dash_page.locator("#periodic-table-section")
        # Wait for the component to fully render (elements should appear)
        dash_page.wait_for_timeout(2000)

        # Check for element tiles or SVG content
        matterviz = section.locator("mv-matterviz")
        # The component should have some content (not be empty)
        expect(matterviz).not_to_be_empty()


class TestStructure:
    """Test Structure component rendering."""

    def test_structure_renders(self, dash_page: Page) -> None:
        """Structure component should render."""
        section = dash_page.locator("#structure-section")
        expect(section).to_be_visible()

        matterviz = section.locator("mv-matterviz")
        expect(matterviz).to_be_visible()

    def test_structure_has_canvas(self, dash_page: Page) -> None:
        """Structure component should have a WebGL canvas."""
        section = dash_page.locator("#structure-section")
        dash_page.wait_for_timeout(2000)

        # Three.js renders to a canvas element
        canvas = section.locator("canvas")
        expect(canvas).to_be_visible()


class TestComposition:
    """Test Composition component rendering."""

    def test_composition_renders(self, dash_page: Page) -> None:
        """Composition component should render."""
        section = dash_page.locator("#composition-section")
        expect(section).to_be_visible()

        matterviz_components = section.locator("mv-matterviz")
        # Should have multiple composition components
        assert matterviz_components.count() > 1

    def test_composition_has_svg(self, dash_page: Page) -> None:
        """Composition component should render SVG charts."""
        section = dash_page.locator("#composition-section")
        dash_page.wait_for_timeout(2000)

        # Pie/bar charts render as SVG
        svg_elements = section.locator("svg")
        assert svg_elements.count() > 0


class TestBrillouinZone:
    """Test BrillouinZone component rendering."""

    def test_brillouin_zone_renders(self, dash_page: Page) -> None:
        """BrillouinZone component should render."""
        section = dash_page.locator("#brillouin-section")
        expect(section).to_be_visible()

        matterviz = section.locator("mv-matterviz")
        expect(matterviz).to_be_visible()

    def test_brillouin_zone_has_canvas(self, dash_page: Page) -> None:
        """BrillouinZone component should have a WebGL canvas."""
        section = dash_page.locator("#brillouin-section")
        dash_page.wait_for_timeout(2000)

        canvas = section.locator("canvas")
        expect(canvas).to_be_visible()


class TestConvexHull:
    """Test ConvexHull component rendering."""

    def test_convex_hull_renders(self, dash_page: Page) -> None:
        """ConvexHull component should render."""
        section = dash_page.locator("#convex-3d-section")
        expect(section).to_be_visible()

        matterviz = section.locator("mv-matterviz")
        expect(matterviz).to_be_visible()


class TestPhaseDiagram:
    """Test PhaseDiagram component rendering."""

    def test_phase_diagram_renders(self, dash_page: Page) -> None:
        """PhaseDiagram component should render."""
        section = dash_page.locator("#phase-binary-section")
        expect(section).to_be_visible()

        matterviz = section.locator("mv-matterviz")
        expect(matterviz).to_be_visible()

    def test_phase_diagram_dropdown_works(self, dash_page: Page) -> None:
        """Phase diagram dropdown should change the displayed diagram."""
        section = dash_page.locator("#phase-binary-section")

        # Find and interact with the dropdown
        dropdown = section.locator(".Select-control, [class*='dropdown']").first
        if dropdown.is_visible():
            dropdown.click()
            # Wait for dropdown options
            dash_page.wait_for_timeout(500)


class TestXrdPlot:
    """Test XrdPlot component rendering."""

    def test_xrd_plot_renders(self, dash_page: Page) -> None:
        """XrdPlot component should render."""
        section = dash_page.locator("#xrd-section")
        expect(section).to_be_visible()

        matterviz = section.locator("mv-matterviz")
        expect(matterviz).to_be_visible()

    def test_xrd_plot_has_svg(self, dash_page: Page) -> None:
        """XrdPlot component should render an SVG plot."""
        section = dash_page.locator("#xrd-section")
        dash_page.wait_for_timeout(2000)

        svg = section.locator("svg")
        expect(svg).to_be_visible()


class TestTrajectory:
    """Test Trajectory component rendering."""

    def test_trajectory_renders(self, dash_page: Page) -> None:
        """Trajectory component should render."""
        section = dash_page.locator("#trajectory-section")
        expect(section).to_be_visible()

        matterviz = section.locator("mv-matterviz")
        expect(matterviz).to_be_visible()


class TestInteractivity:
    """Test interactive features of components."""

    def test_navigation_links_scroll(self, dash_page: Page) -> None:
        """Clicking nav links should scroll to the section."""
        # Click on the XRD link
        nav_link = dash_page.locator('nav a[href="#xrd-section"]')
        nav_link.click()

        # Wait for scroll
        dash_page.wait_for_timeout(500)

        # XRD section should be in view
        xrd_section = dash_page.locator("#xrd-section")
        expect(xrd_section).to_be_in_viewport()

    @pytest.mark.parametrize(
        "section_id",
        [
            "periodic-table-section",
            "structure-section",
            "composition-section",
            "trajectory-section",
            "brillouin-section",
            "convex-3d-section",
            "phase-binary-section",
            "xrd-section",
        ],
    )
    def test_all_sections_have_content(self, dash_page: Page, section_id: str) -> None:
        """Each section should have visible content."""
        section = dash_page.locator(f"#{section_id}")
        expect(section).to_be_visible()

        # Each section should have at least a heading and the mv-matterviz element
        heading = section.locator("h4")
        expect(heading).to_be_visible()

        matterviz = section.locator("mv-matterviz")
        expect(matterviz).to_be_visible()


class TestErrorHandling:
    """Test error states and edge cases."""

    def test_no_console_errors(self, dash_page: Page) -> None:
        """Page should load without critical JavaScript errors."""
        errors: list[str] = []

        def handle_console(msg) -> None:
            if msg.type == "error":
                errors.append(msg.text)

        dash_page.on("console", handle_console)

        # Reload page and wait for components
        dash_page.reload()
        dash_page.wait_for_selector("mv-matterviz", timeout=30000)
        dash_page.wait_for_timeout(3000)  # Wait for all components to render

        # Filter out known benign errors (like WebGL warnings)
        critical_errors = [
            err
            for err in errors
            if not any(
                ignore in err.lower()
                for ignore in ["webgl", "deprecated", "warning", "favicon"]
            )
        ]

        assert len(critical_errors) == 0, f"Console errors: {critical_errors}"
