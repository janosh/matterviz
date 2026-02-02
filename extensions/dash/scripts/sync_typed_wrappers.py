"""
Generate typed Python wrapper classes for selected MatterViz components.

This shim exposes a single generic Dash component (MatterViz) which forwards an arbitrary
JSON-serializable `mv_props` dict to a selected MatterViz Svelte component.

This script adds *typed* Python wrappers (subclasses of MatterViz) for IDE discoverability.

How props are discovered
------------------------
The MatterViz npm package ships TypeScript declaration files next to its compiled Svelte
components:

  node_modules/matterviz/dist/**/<Component>.svelte.d.ts

These contain a `type $$ComponentProps = ...` (often) or a `type Props = ...` plus a Svelte
component declaration like:

  declare const Foo: import("svelte").Component<$$ComponentProps, ...>;

We extract the first type argument of `import("svelte").Component<...>` and collect property
names from any object literals in that expression, recursively following simple `type X = {...}`
aliases used in the same file (e.g. EventHandlers).

A small TOML manifest (component_manifest.toml) curates which components to expose and allows
overrides.

Usage
-----
  python scripts/sync_typed_wrappers.py \
      --manifest component_manifest.toml \
      --matterviz-dist node_modules/matterviz/dist \
      --out matterviz_dash_components/typed.py
"""

from __future__ import annotations

import argparse
import keyword
import os
import re
import subprocess
from dataclasses import dataclass
from glob import glob
from typing import Any

import tomllib


@dataclass(frozen=True)
class Prop:
    js_name: str
    py_name: str
    ts_type: str
    required: bool
    kind: str  # "value" | "callback" | "snippet" | "dom"


class BracketTracker:
    """Track nesting depth for (), [], {}, <> and string quotes."""

    __slots__ = ("par", "brk", "brc", "ang", "in_bt", "in_sq", "in_dq")

    def __init__(self) -> None:
        self.par = self.brk = self.brc = self.ang = 0
        self.in_bt = self.in_sq = self.in_dq = False

    def update(self, src: str, idx: int) -> bool:
        """Update state for character at src[idx]. Returns True if inside a string.

        Handles escaped quotes by counting preceding backslashes (odd = escaped).
        """
        ch = src[idx]
        prev = src[idx - 1] if idx > 0 else ""

        # Count consecutive backslashes before this character
        bs_count, pos = 0, idx - 1
        while pos >= 0 and src[pos] == "\\":
            bs_count += 1
            pos -= 1
        is_escaped = bs_count % 2 == 1

        if ch == "`" and not self.in_sq and not self.in_dq and not is_escaped:
            self.in_bt = not self.in_bt
            return True
        if ch == "'" and not self.in_bt and not self.in_dq and not is_escaped:
            self.in_sq = not self.in_sq
            return True
        if ch == '"' and not self.in_bt and not self.in_sq and not is_escaped:
            self.in_dq = not self.in_dq
            return True
        if self.in_string:
            return True

        if ch == "(":
            self.par += 1
        elif ch == ")":
            self.par = max(0, self.par - 1)
        elif ch == "[":
            self.brk += 1
        elif ch == "]":
            self.brk = max(0, self.brk - 1)
        elif ch == "{":
            self.brc += 1
        elif ch == "}":
            self.brc = max(0, self.brc - 1)
        elif ch == "<":
            self.ang += 1
        elif ch == ">" and prev != "=":  # Ignore '=>' arrows
            self.ang = max(0, self.ang - 1)
        return False

    @property
    def in_string(self) -> bool:
        return self.in_bt or self.in_sq or self.in_dq

    @property
    def at_top_level(self) -> bool:
        return self.par == self.brk == self.brc == self.ang == 0


def _to_snake(name: str) -> str:
    """Convert a TS prop name to a Python-friendly snake_case identifier."""
    if name.isupper():
        out = name.lower()
    else:
        s1 = re.sub(r"(.)([A-Z][a-z]+)", r"\1_\2", name)
        out = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", s1).lower()

    out = out.replace("-", "_") or "prop"
    if out[0].isdigit():
        out = f"p_{out}"
    if keyword.iskeyword(out):
        out += "_"
    return out


def _split_top_level(expr: str, sep: str) -> list[str]:
    """Split expr on sep only when not nested in (), [], {}, <> or quotes."""
    parts: list[str] = []
    start = 0
    tracker = BracketTracker()

    for idx, ch in enumerate(expr):
        if tracker.update(expr, idx):
            continue
        if ch == sep and tracker.at_top_level:
            parts.append(expr[start:idx].strip())
            start = idx + 1

    tail = expr[start:].strip()
    if tail:
        parts.append(tail)
    return parts


def _find_matching_angle(src: str, open_idx: int) -> int:
    """Find matching '>' for '<' at open_idx, respecting nested generics."""
    assert src[open_idx] == "<"
    depth = 0
    tracker = BracketTracker()

    for idx in range(open_idx, len(src)):
        ch = src[idx]
        prev = src[idx - 1] if idx > 0 else ""

        if ch in "`'\"":
            tracker.update(src, idx)
            continue
        if tracker.in_string:
            continue

        if ch == "<":
            depth += 1
        elif ch == ">" and prev != "=":
            depth -= 1
            if depth == 0:
                return idx

    raise ValueError("Unmatched '<' while scanning generic type arguments")


def _extract_type_aliases(src: str) -> dict[str, str]:
    """Extract simple `type Name = ...;` aliases from a .d.ts file."""
    aliases: dict[str, str] = {}

    for match in re.finditer(r"\btype\s+([A-Za-z0-9_]+)\s*=", src):
        name = match.group(1)
        expr_start = match.end()
        tracker = BracketTracker()

        for idx in range(expr_start, len(src)):
            if tracker.update(src, idx):
                continue
            if src[idx] == ";" and tracker.at_top_level:
                aliases[name] = src[expr_start:idx].strip()
                break

    return aliases


def _extract_props_root_expr(src: str, *, debug: bool = False) -> tuple[str, str]:
    """
    Extract the type expression that represents component props.

    Returns: (props_expression, strategy_name)

    Tries in order:
      1) `type $$ComponentProps = ...`
      2) `declare function $$render<...>(): { props: ... }`
      3) First type arg of `import("svelte").Component<...>`
    """
    # Strategy 1: type $$ComponentProps = ...
    if match := re.search(r"type\s+\$\$ComponentProps\s*=", src):
        expr_start = match.end()
        if m_end := re.search(r";\s*declare\s+const", src[expr_start:]):
            result = src[expr_start : expr_start + m_end.start()].strip()
            if debug:
                print("  [props] Strategy '$$ComponentProps' succeeded")
            return result, "$$ComponentProps"
        if (semi := src.find(";", expr_start)) != -1:
            if debug:
                print("  [props] Strategy '$$ComponentProps' succeeded")
            return src[expr_start:semi].strip(), "$$ComponentProps"

    # Strategy 2: $$render function format (generic components)
    if match := re.search(r"declare\s+function\s+\$\$render[^{]*\{\s*props\s*:", src):
        props_start = match.end()
        tracker = BracketTracker()
        for idx in range(props_start, len(src)):
            if tracker.update(src, idx):
                continue
            if src[idx] == ";" and tracker.at_top_level:
                if debug:
                    print("  [props] Strategy '$$render' succeeded")
                return src[props_start:idx].strip(), "$$render"
        # Fallback
        if debug:
            print("  [props] Strategy '$$render' succeeded (fallback)")
        return src[props_start:].split(";")[0].strip(), "$$render"

    # Strategy 3: parse Component<...> generic
    if not (match := re.search(r'import\("svelte"\)\.Component<', src)):
        raise ValueError(
            "Could not extract props: no $$ComponentProps, $$render, or Component<...> found"
        )

    open_idx = match.end() - 1
    close_idx = _find_matching_angle(src, open_idx)
    inside = src[match.end() : close_idx]
    args = _split_top_level(inside, ",")

    if not args:
        raise ValueError("Could not parse Component<...> type arguments")

    if debug:
        print("  [props] Strategy 'Component<...>' succeeded")
    return args[0].strip(), "Component<...>"


def _parse_object_literal(obj: str) -> dict[str, tuple[str, bool]]:
    """Parse `{ foo?: string; bar: number }` into {foo: (type, required)}."""
    obj = obj.strip()
    if not (obj.startswith("{") and obj.endswith("}")):
        raise ValueError("Expected {...} object literal")

    inner = obj[1:-1].strip()
    if not inner:
        return {}

    items: list[str] = []
    start = 0
    tracker = BracketTracker()

    for idx, ch in enumerate(inner):
        if tracker.update(inner, idx):
            continue
        if ch == ";" and tracker.at_top_level:
            if item := inner[start:idx].strip():
                items.append(item)
            start = idx + 1

    if tail := inner[start:].strip():
        items.append(tail)

    props: dict[str, tuple[str, bool]] = {}
    for item in items:
        if item.startswith("[") or item.startswith("..."):  # index sig or spread
            continue
        if match := re.match(r"^([A-Za-z0-9_]+)\s*(\?)?\s*:\s*(.+)$", item):
            props[match.group(1)] = (match.group(3).strip(), match.group(2) != "?")

    return props


def _resolve_component_props_ref(
    term: str, src: str, dist_dir: str | None, visited: set[str]
) -> dict[str, tuple[str, bool]]:
    """Resolve ComponentProps<typeof X> to the props of component X."""
    match = re.match(r"ComponentProps\s*<\s*typeof\s+(\w+)\s*>", term)
    if not match or not dist_dir:
        return {}

    component_name = match.group(1)
    if component_name in visited:
        return {}
    visited.add(component_name)

    # Find the import path
    import_match = re.search(
        rf"import\s+{component_name}\s+from\s+['\"]([^'\"]+)['\"]", src
    )
    if not import_match:
        return {}

    import_path = import_match.group(1)
    component_file = import_path.split("/")[-1].replace(".svelte", ".svelte.d.ts")
    subdir = import_path.split("/")[-2] if "/" in import_path else ""

    candidates = glob(f"{dist_dir}/**/{component_file}", recursive=True)
    if subdir:
        candidates = [p for p in candidates if subdir in p] or candidates
    if not candidates:
        return {}

    with open(candidates[0], encoding="utf-8") as file:
        ref_src = file.read()
    try:
        ref_expr, _ = _extract_props_root_expr(ref_src)
        return _collect_props(
            ref_expr, _extract_type_aliases(ref_src), dist_dir, visited, ref_src
        )
    except ValueError:
        return {}


def _collect_props(
    expr: str,
    aliases: dict[str, str],
    dist_dir: str | None = None,
    visited: set[str] | None = None,
    src: str = "",
) -> dict[str, tuple[str, bool]]:
    """Collect props from an intersection type expression."""
    if visited is None:
        visited = set()
    out: dict[str, tuple[str, bool]] = {}

    for term in _split_top_level(expr, "&"):
        term = term.strip()
        if not term:
            continue

        if term.startswith("{"):
            # Find matching brace
            tracker = BracketTracker()
            for idx, ch in enumerate(term):
                if tracker.update(term, idx):
                    continue
                if ch == "}" and tracker.brc == 0:
                    out.update(_parse_object_literal(term[: idx + 1]))
                    break
            continue

        if term.startswith("ComponentProps<"):
            out.update(_resolve_component_props_ref(term, src, dist_dir, visited))
            continue

        # Follow type aliases
        if (
            re.fullmatch(r"[A-Za-z0-9_]+", term)
            and term in aliases
            and term not in visited
        ):
            visited.add(term)
            out.update(_collect_props(aliases[term], aliases, dist_dir, visited, src))

    return out


def _parse_interface_props(
    src: str, interface_name: str
) -> dict[str, tuple[str, bool]]:
    """Extract props from an interface definition in a .d.ts file."""
    pattern = rf"\binterface\s+{re.escape(interface_name)}(?:<[^>]*>)?(?:\s+extends\s+[^{{]+)?\s*\{{"
    if not (match := re.search(pattern, src)):
        return {}

    brace_start = match.end() - 1
    depth = 1
    idx = brace_start + 1
    while idx < len(src) and depth > 0:
        if src[idx] == "{":
            depth += 1
        elif src[idx] == "}":
            depth -= 1
        idx += 1

    return _parse_object_literal(src[brace_start:idx])


def parse_external_type(
    dist_dir: str, include_spec: str
) -> dict[str, tuple[str, bool]]:
    """Parse a type/interface from an external .d.ts file.

    include_spec format: "path/to/file.d.ts:TypeName"
    """
    if ":" not in include_spec:
        return {}

    file_path, type_name = include_spec.rsplit(":", 1)
    dts_path = f"{dist_dir}/{file_path}"
    if not os.path.isfile(dts_path):
        print(f"Warning: External type file not found: {dts_path}")
        return {}

    with open(dts_path, encoding="utf-8") as fh:
        src = fh.read()

    # Try interface first, then type alias
    if props := _parse_interface_props(src, type_name):
        return props

    aliases = _extract_type_aliases(src)
    if type_name in aliases:
        return _collect_props(aliases[type_name], aliases, dist_dir, src=src)

    return {}


def _detect_prop_kind(ts_type: str) -> str:
    """Determine prop kind based on TypeScript type signature."""
    if "=>" in ts_type:
        return "callback"
    if "Snippet" in ts_type:
        return "snippet"
    if "HTMLElement" in ts_type or "HTMLDivElement" in ts_type:
        return "dom"
    return "value"


def parse_svelte_dts(
    dts_path: str,
    dist_dir: str | None = None,
    *,
    debug: bool = False,
) -> tuple[list[Prop], list[str], list[str], list[str]]:
    """Parse a *.svelte.d.ts file into prop metadata."""
    with open(dts_path, encoding="utf-8") as fh:
        src = fh.read()
    aliases = _extract_type_aliases(src)
    root_expr, strategy = _extract_props_root_expr(src, debug=debug)

    if debug:
        print(f"  Extracted props via: {strategy}")

    js_props = _collect_props(root_expr, aliases, dist_dir, src=src)

    props: list[Prop] = []
    callback_props: list[str] = []
    snippet_props: list[str] = []
    dom_props: list[str] = []

    for js_name, (ts_type, required) in sorted(js_props.items()):
        kind = _detect_prop_kind(ts_type)
        if kind == "callback":
            callback_props.append(js_name)
        elif kind == "snippet":
            snippet_props.append(js_name)
        elif kind == "dom":
            dom_props.append(js_name)

        props.append(Prop(js_name, _to_snake(js_name), ts_type, required, kind))

    return props, callback_props, snippet_props, dom_props


def parse_svelte_dts_with_includes(
    dts_path: str, dist_dir: str, include_from: list[str]
) -> tuple[list[Prop], list[str], list[str], list[str]]:
    """Parse a *.svelte.d.ts file with additional external type includes."""
    props, callback_props, snippet_props, dom_props = parse_svelte_dts(
        dts_path, dist_dir
    )
    existing = {p.js_name for p in props}

    for include_spec in include_from:
        for js_name, (ts_type, required) in parse_external_type(
            dist_dir, include_spec
        ).items():
            if js_name in existing:
                continue

            kind = _detect_prop_kind(ts_type)
            if kind == "callback":
                callback_props.append(js_name)
            elif kind == "snippet":
                snippet_props.append(js_name)
            elif kind == "dom":
                dom_props.append(js_name)

            props.append(Prop(js_name, _to_snake(js_name), ts_type, required, kind))
            existing.add(js_name)

    return props, callback_props, snippet_props, dom_props


def add_extra_props(
    props: list[Prop], extra_props: dict[str, str], callback_props: list[str]
) -> None:
    """Add manually-specified extra props to the props list."""
    existing = {p.js_name for p in props}
    for js_name, ts_type in extra_props.items():
        if js_name in existing:
            continue
        kind = "callback" if "=>" in ts_type else "value"
        if kind == "callback":
            callback_props.append(js_name)
        props.append(Prop(js_name, _to_snake(js_name), ts_type, True, kind))


def find_component_dts(dist_dir: str, key: str) -> str:
    """Resolve a manifest key to a *.svelte.d.ts file."""
    if "/" in key:
        path = f"{dist_dir}/{key}.svelte.d.ts"
        if not os.path.isfile(path):
            raise FileNotFoundError(path)
        return path

    matches = glob(f"{dist_dir}/**/{key}.svelte.d.ts", recursive=True)
    if not matches:
        raise FileNotFoundError(f"No match for {key!r} under {dist_dir}")
    if len(matches) > 1:
        rel = ", ".join(p.replace(f"{dist_dir}/", "") for p in matches)
        raise RuntimeError(f"Ambiguous key={key!r}. Matches: {rel}. Use a path key.")
    return matches[0]


# Heuristic keywords for inferring int type from TS number type.
# Override in manifest via [components.Name.type_hints] if this fails.
_INT_KEYWORDS = ("_idx", "_index", "_count", "n_bins", "n_ticks", "num_", "sites")


def _py_type_hint(
    ts_type: str, prop_name: str = "", type_hints: dict[str, str] | None = None
) -> str:
    """Conservative TS->Python type hint mapper.

    Type Inference:
        - number -> float (or int if prop_name contains _idx, _index, etc.)
        - Override via manifest [components.Name.type_hints]
    """
    if type_hints and prop_name in type_hints:
        return type_hints[prop_name]

    t = ts_type.strip()

    if t == "string":
        return "str"
    if t == "number":
        return "int" if any(kw in prop_name for kw in _INT_KEYWORDS) else "float"
    if t == "boolean":
        return "bool"
    if t.endswith("[]"):
        inner = _py_type_hint(t[:-2].strip(), prop_name, type_hints)
        return f"list[{inner}]" if inner != "Any" else "list"
    if "Record" in t or "Partial" in t or "ComponentProps" in t:
        return "dict"
    if "Set" in t:
        return "list"
    if "Float32Array" in t:
        return "list[float]"
    if t.startswith("[") and t.endswith("]"):
        return "list"
    if "|" in t:
        parts = [
            p.strip() for p in t.split("|") if p.strip() not in ("null", "undefined")
        ]
        if parts:
            return _py_type_hint(parts[0], prop_name, type_hints)
    return "Any"


def generate_wrappers(manifest: dict[str, Any], dist_dir: str) -> str:
    """Generate typed Python wrapper classes from manifest and return as string."""
    components = manifest.get("components", {})
    if not components:
        raise SystemExit("Manifest has no [components.*] sections")

    lines = [
        "# AUTO-GENERATED by scripts/sync_typed_wrappers.py - DO NOT EDIT",
        "#",
        "# Type Inference: number -> float (int if prop contains _idx/_index/_count/etc.)",
        "# Override via manifest [components.Name.type_hints] = { prop = 'int' }",
        "",
        "from __future__ import annotations",
        "",
        "from typing import Any",
        "",
        "from .MatterViz import MatterViz",
        "",
    ]

    for class_name, spec in components.items():
        key = spec.get("key")
        if not key:
            raise SystemExit(f"[components.{class_name}] missing 'key'")

        dts_path = find_component_dts(dist_dir, key)
        include_from = spec.get("include_from", [])

        if include_from:
            props, callback_props, snippet_props, dom_props = (
                parse_svelte_dts_with_includes(dts_path, dist_dir, include_from)
            )
        else:
            props, callback_props, snippet_props, dom_props = parse_svelte_dts(
                dts_path, dist_dir
            )

        if extra := spec.get("extra_props", {}):
            add_extra_props(props, extra, callback_props)

        # Filter to JSON-serializable value props
        value_props = [
            p
            for p in props
            if p.kind == "value"
            and p.js_name not in dom_props
            and p.js_name != "children"
        ]

        # Auto-detect conversion defaults
        auto_set = [p.js_name for p in value_props if "Set" in p.ts_type]
        auto_float32 = [p.js_name for p in value_props if "Float32Array" in p.ts_type]

        default_set_props = spec.get("set_props", auto_set)
        default_float32_props = spec.get("float32_props", auto_float32)
        alias_overrides = spec.get("aliases", {}) or {}
        type_hints = spec.get("type_hints", {}) or {}

        # Build python->js mapping with unique identifiers
        py_to_js: dict[str, str] = {}
        used_py: set[str] = set()
        for p in value_props:
            py, js = p.py_name, alias_overrides.get(p.py_name, p.js_name)
            base = py
            suffix = 2
            while py in used_py:
                py = f"{base}_{suffix}"
                suffix += 1
            used_py.add(py)
            py_to_js[py] = js

        # Generate class
        doc = (spec.get("doc") or "").strip() or f"Typed wrapper for '{key}'."
        lines.append(f"class {class_name}(MatterViz):")
        lines.append(f'    """{doc}')
        lines.append("")
        lines.append(f"    Component key: ``{key}``")
        if callback_props:
            lines.append(f"\n    Events: {', '.join(callback_props)}")
        if snippet_props:
            lines.append(f"\n    Unsupported snippets: {', '.join(snippet_props)}")
        lines.append('    """')
        lines.append("")

        # Build signature
        sig = ["self", "id=None"]
        js_to_prop = {p.js_name: p for p in value_props}
        for py, js in py_to_js.items():
            p = js_to_prop.get(js)
            if p is None:
                raise ValueError(
                    f"[{class_name}] alias '{py}' maps to unknown JS prop '{js}'. "
                    f"Valid props: {list(js_to_prop.keys())}"
                )
            sig.append(
                f"{py}: {_py_type_hint(p.ts_type, py, type_hints)} | None = None"
            )
        sig += [
            "mv_props: dict | None = None",
            "set_props: list[str] | None = None",
            "float32_props: list[str] | None = None",
            "event_props: list[str] | None = None",
            "last_event: dict | None = None",
            "className: str | None = None",
            "style: dict | None = None",
            "**kwargs",
        ]

        params = ",\n        ".join(sig)
        lines.append(f"    def __init__(\n        {params},\n    ):")
        lines.append("        if mv_props is None:")
        lines.append("            mv_props = {}")
        for py, js in py_to_js.items():
            lines.append(f"        if {py} is not None:")
            lines.append(f'            mv_props["{js}"] = {py}')
        if default_set_props:
            lines.append("        if set_props is None:")
            formatted = "[" + ", ".join(f'"{s}"' for s in default_set_props) + "]"
            lines.append(f"            set_props = {formatted}")
        if default_float32_props:
            lines.append("        if float32_props is None:")
            formatted = "[" + ", ".join(f'"{s}"' for s in default_float32_props) + "]"
            lines.append(f"            float32_props = {formatted}")
        lines.append("")
        lines.append("        super().__init__(")
        lines.append(f'            id=id, component="{key}", mv_props=mv_props,')
        lines.append("            set_props=set_props, float32_props=float32_props,")
        lines.append("            event_props=event_props, last_event=last_event,")
        lines.append("            className=className, style=style, **kwargs,")
        lines.append("        )")
        lines.append("")

    return "\n".join(lines)


def main() -> None:
    """CLI entry point for generating typed wrappers."""
    # Path to extensions/dash/ directory (parent of scripts/)
    dash_root = os.path.dirname(os.path.dirname(__file__))

    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", default=f"{dash_root}/component_manifest.toml")
    ap.add_argument(
        "--matterviz-dist", default=f"{dash_root}/node_modules/matterviz/dist"
    )
    ap.add_argument("--out", default=f"{dash_root}/matterviz_dash_components/typed.py")
    ap.add_argument(
        "--check",
        action="store_true",
        help="Check if typed.py is up-to-date without writing. Exit 1 if outdated.",
    )
    args = ap.parse_args()

    manifest_path = args.manifest
    dist_dir = args.matterviz_dist
    out_path = args.out

    if not os.path.isfile(manifest_path):
        raise SystemExit(f"Manifest not found: {manifest_path}")
    if not os.path.isdir(dist_dir):
        raise SystemExit(
            f"MatterViz dist not found: {dist_dir}\nRun `pnpm install` first."
        )

    with open(manifest_path, encoding="utf-8") as fh:
        manifest = tomllib.loads(fh.read())

    expected = generate_wrappers(manifest, dist_dir)

    if args.check:
        # Compare generated content with existing file
        if not os.path.isfile(out_path):
            print(f"FAIL: {out_path} does not exist. Run sync_typed_wrappers.py first.")
            raise SystemExit(1)

        with open(out_path, encoding="utf-8") as fh:
            actual = fh.read()
        if actual != expected:
            print(f"FAIL: {out_path} is out of sync with component_manifest.toml")
            print("Run: python extensions/dash/scripts/sync_typed_wrappers.py")
            raise SystemExit(1)

        print(f"OK: {out_path} is up-to-date")
        raise SystemExit(0)

    with open(out_path, "w", encoding="utf-8") as fh:
        fh.write(expected)

    # Format with ruff (optional - file is valid without formatting)
    try:
        subprocess.run(["ruff", "format", out_path], check=True, capture_output=True)
    except FileNotFoundError:
        print(f"Warning: ruff not found, skipping formatting of {out_path}")
    except subprocess.CalledProcessError as exc:
        print(f"Warning: ruff format failed: {exc.stderr.decode().strip() or exc}")

    print(f"Wrote {out_path}")


if __name__ == "__main__":
    main()
