# AUTO-GENERATED STYLE (but maintained manually in this repo)
#
# This is a minimal Dash component wrapper for the React component `MatterViz`.
# It intentionally keeps the prop surface small; MatterViz props are passed via
# `mv_props` (a JSON-serializable dict).

from dash.development.base_component import Component, _explicitize_args

_NAMESPACE = "matterviz_dash_components"


class MatterViz(Component):
    """Render MatterViz (Svelte) components in Dash.

    Props
    -----
    component: str
        Component identifier (e.g. "Structure" or "structure/Structure").
    mv_props: dict
        Props forwarded to the selected MatterViz component.
    set_props: list[str]
        Names of mv_props keys to convert list -> Set on the JS side.
    float32_props: list[str]
        Names of mv_props keys to convert list -> Float32Array on the JS side.
    event_props: list[str]
        Names of callback props to inject client-side (e.g. ["on_file_load"]).
        Each callback updates last_event.
    last_event: dict
        Updated whenever any injected callback fires.
    """

    _children_props: list[str] = []
    _base_nodes: list[str] = []

    _namespace = _NAMESPACE
    _type = "MatterViz"

    # Asset definitions - required for Dash to serve JS/CSS bundles
    _js_dist = [
        {
            "relative_package_path": "matterviz_dash_components.min.js",
            "namespace": _NAMESPACE,
        },
    ]
    _css_dist = [
        {
            "relative_package_path": "matterviz_dash_components.css",
            "namespace": _NAMESPACE,
        },
    ]

    _valid_wildcard_attributes: list[str] = []

    _prop_names = [
        "id",
        "component",
        "mv_props",
        "set_props",
        "float32_props",
        "event_props",
        "last_event",
        "className",
        "style",
    ]

    available_properties = _prop_names
    available_wildcard_properties: list[str] = []

    @_explicitize_args
    def __init__(
        self,
        id=None,
        component=None,
        mv_props=None,
        set_props=None,
        float32_props=None,
        event_props=None,
        last_event=None,
        className=None,
        style=None,
        _explicit_args=None,
        **kwargs,
    ):
        # _explicit_args is injected by @_explicitize_args decorator and captured above.
        super().__init__(
            id=id,
            component=component,
            mv_props=mv_props,
            set_props=set_props,
            float32_props=float32_props,
            event_props=event_props,
            last_event=last_event,
            className=className,
            style=style,
            **kwargs,
        )
