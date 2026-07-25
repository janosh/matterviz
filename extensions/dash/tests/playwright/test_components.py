"""Playwright integration tests for MatterViz Dash components."""

from __future__ import annotations

from playwright.sync_api import Page, expect


class TestPageLoad:
    """Test that the sample app loads correctly."""

    def test_page_title_and_navigation_load(self, dash_page: Page) -> None:
        """Page should load its title and navigation links."""
        expect(dash_page.locator("h1")).to_contain_text("MatterViz Dash demo")
        nav = dash_page.locator("nav")
        expect(nav).to_be_visible()
        assert nav.locator("a").count() > 3


class TestPeriodicTable:
    """Test PeriodicTable component rendering (in callback section)."""

    def test_periodic_table_renders_elements(self, dash_page: Page) -> None:
        """PeriodicTable should render visible element content."""
        section = dash_page.locator("#callback-section")
        expect(section).to_be_visible()

        matterviz = section.locator("mv-matterviz#callback-periodic-table")
        expect(matterviz).to_be_visible()
        expect(matterviz).not_to_be_empty()


class TestStructure:
    """Test Structure component rendering."""

    def test_structure_renders(self, dash_page: Page) -> None:
        """Structure component should render."""
        heading = dash_page.locator("#structure-section")
        expect(heading).to_be_visible()

        matterviz = dash_page.locator("mv-matterviz#structure")
        expect(matterviz).to_be_visible()


class TestComposition:
    """Test Composition component rendering."""

    def test_composition_renders_svg_charts(self, dash_page: Page) -> None:
        """Composition components should render visible SVG charts."""
        section = dash_page.locator("#composition-section")
        expect(section).to_be_visible()

        matterviz_components = section.locator("mv-matterviz")
        assert matterviz_components.count() > 1
        svg_elements = section.locator("svg")
        assert svg_elements.count() > 0
        expect(svg_elements.first).to_be_visible()


class TestBrillouinZone:
    """Test BrillouinZone component rendering."""

    def test_brillouin_zone_renders_canvas(self, dash_page: Page) -> None:
        """BrillouinZone should render a visible WebGL canvas."""
        section = dash_page.locator("#brillouin-section")
        expect(section).to_be_visible()

        matterviz = section.locator("mv-matterviz")
        expect(matterviz).to_be_visible()
        expect(section.locator("canvas").first).to_be_visible()


class TestConvexHull:
    """Test ConvexHull component rendering."""

    def test_convex_hull_renders(self, dash_page: Page) -> None:
        """ConvexHull component should render."""
        section = dash_page.locator("#convex-2d-section")
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


class TestXrdPlot:
    """Test XrdPlot component rendering."""

    def test_xrd_plot_renders_svg(self, dash_page: Page) -> None:
        """XrdPlot should render a visible SVG plot."""
        section = dash_page.locator("#xrd-section")
        expect(section).to_be_visible()

        matterviz = section.locator("mv-matterviz")
        expect(matterviz).to_be_visible()
        expect(section.locator("svg").first).to_be_visible()


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

        # XRD section should be in view
        xrd_section = dash_page.locator("#xrd-section")
        expect(xrd_section).to_be_in_viewport()


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
