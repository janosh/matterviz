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
import re
import textwrap
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import tomllib


@dataclass(frozen=True)
class Prop:
    js_name: str
    py_name: str
    ts_type: str
    required: bool
    kind: str  # "value" | "callback" | "snippet" | "dom"


# ----------------------------
# Small parsing utilities
# ----------------------------

def _is_arrow_gt(src: str, i: int) -> bool:
    """Return True if src[i] is '>' in a '=>' arrow."""
    return src[i] == ">" and i > 0 and src[i - 1] == "="


def _to_snake(name: str) -> str:
    """Convert a TS prop name to a Python-friendly snake_case identifier."""
    if name.isupper():
        out = name.lower()
    else:
        s1 = re.sub(r"(.)([A-Z][a-z]+)", r"\1_\2", name)
        s2 = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", s1)
        out = s2.lower()

    out = out.replace("-", "_")
    if not out:
        out = "prop"

    if out[0].isdigit():
        out = f"p_{out}"

    if keyword.iskeyword(out):
        out = out + "_"

    return out


def _split_top_level(expr: str, sep: str) -> List[str]:
    """Split expr on sep only when not nested in (), [], {}, <> or quotes/backticks."""
    parts: List[str] = []
    start = 0

    par = brk = brc = ang = 0
    in_bt = in_sq = in_dq = False

    for i, ch in enumerate(expr):
        # Toggle string modes
        if ch == "`" and not in_sq and not in_dq:
            in_bt = not in_bt
            continue
        if ch == "'" and not in_bt and not in_dq:
            in_sq = not in_sq
            continue
        if ch == '"' and not in_bt and not in_sq:
            in_dq = not in_dq
            continue

        if in_bt or in_sq or in_dq:
            continue

        if ch == "(":
            par += 1
        elif ch == ")":
            par = max(0, par - 1)
        elif ch == "[":
            brk += 1
        elif ch == "]":
            brk = max(0, brk - 1)
        elif ch == "{":
            brc += 1
        elif ch == "}":
            brc = max(0, brc - 1)
        elif ch == "<":
            ang += 1
        elif ch == ">" and not _is_arrow_gt(expr, i):
            ang = max(0, ang - 1)
        elif ch == sep and par == brk == brc == ang == 0:
            parts.append(expr[start:i].strip())
            start = i + 1

    tail = expr[start:].strip()
    if tail:
        parts.append(tail)
    return parts


def _find_matching_angle(src: str, open_idx: int) -> int:
    """Find matching '>' for '<' at open_idx, respecting nested generics and ignoring '=>'."""
    assert src[open_idx] == "<"
    depth = 0
    in_bt = in_sq = in_dq = False

    for i in range(open_idx, len(src)):
        ch = src[i]

        if ch == "`" and not in_sq and not in_dq:
            in_bt = not in_bt
            continue
        if ch == "'" and not in_bt and not in_dq:
            in_sq = not in_sq
            continue
        if ch == '"' and not in_bt and not in_sq:
            in_dq = not in_dq
            continue
        if in_bt or in_sq or in_dq:
            continue

        if ch == "<":
            depth += 1
        elif ch == ">" and not _is_arrow_gt(src, i):
            depth -= 1
            if depth == 0:
                return i

    raise ValueError("Unmatched '<' while scanning generic type arguments")


def _extract_type_aliases(src: str) -> Dict[str, str]:
    """Extract simple `type Name = ...;` aliases from a .d.ts file."""
    aliases: Dict[str, str] = {}
    for m in re.finditer(r"\btype\s+([A-Za-z0-9_]+)\s*=", src):
        name = m.group(1)
        expr_start = m.end()

        par = brk = brc = ang = 0
        in_bt = in_sq = in_dq = False

        for i in range(expr_start, len(src)):
            ch = src[i]

            if ch == "`" and not in_sq and not in_dq:
                in_bt = not in_bt
                continue
            if ch == "'" and not in_bt and not in_dq:
                in_sq = not in_sq
                continue
            if ch == '"' and not in_bt and not in_sq:
                in_dq = not in_dq
                continue
            if in_bt or in_sq or in_dq:
                continue

            if ch == "(":
                par += 1
            elif ch == ")":
                par = max(0, par - 1)
            elif ch == "[":
                brk += 1
            elif ch == "]":
                brk = max(0, brk - 1)
            elif ch == "{":
                brc += 1
            elif ch == "}":
                brc = max(0, brc - 1)
            elif ch == "<":
                ang += 1
            elif ch == ">" and not _is_arrow_gt(src, i):
                ang = max(0, ang - 1)
            elif ch == ";" and par == brk == brc == ang == 0:
                aliases[name] = src[expr_start:i].strip()
                break

    return aliases


def _extract_props_root_expr(src: str) -> str:
    """
    Extract the type expression that represents component props.

    Preference order:
      1) RHS of `type $$ComponentProps = ...` (if present)
      2) First type argument of `import("svelte").Component<...>`
    """
    m = re.search(r"type\s+\$\$ComponentProps\s*=", src)
    if m:
        expr_start = m.end()
        m_end = re.search(r";\s*declare\s+const", src[expr_start:])
        if m_end:
            return src[expr_start : expr_start + m_end.start()].strip()
        semi = src.find(";", expr_start)
        if semi != -1:
            return src[expr_start:semi].strip()

    # Fallback: parse Component<...> generic
    m = re.search(r'import\("svelte"\)\.Component<', src)
    if not m:
        raise ValueError("Could not locate import(\"svelte\").Component<...>")

    open_idx = m.end() - 1  # points to '<'
    close_idx = _find_matching_angle(src, open_idx)

    inside = src[m.end() : close_idx]  # between < and >
    args = _split_top_level(inside, ",")
    if not args:
        raise ValueError("Could not parse Component<...> type arguments")

    return args[0].strip()


def _parse_object_literal(obj: str) -> Dict[str, Tuple[str, bool]]:
    """Parse `{ foo?: string; bar: number }` into {foo: (type, required)}."""
    obj = obj.strip()
    if not (obj.startswith("{") and obj.endswith("}")):
        raise ValueError("Expected {...} object literal")

    inner = obj[1:-1].strip()
    if not inner:
        return {}

    items: List[str] = []
    start = 0
    par = brk = brc = ang = 0
    in_bt = in_sq = in_dq = False

    for i, ch in enumerate(inner):
        if ch == "`" and not in_sq and not in_dq:
            in_bt = not in_bt
            continue
        if ch == "'" and not in_bt and not in_dq:
            in_sq = not in_sq
            continue
        if ch == '"' and not in_bt and not in_sq:
            in_dq = not in_dq
            continue
        if in_bt or in_sq or in_dq:
            continue

        if ch == "(":
            par += 1
        elif ch == ")":
            par = max(0, par - 1)
        elif ch == "[":
            brk += 1
        elif ch == "]":
            brk = max(0, brk - 1)
        elif ch == "{":
            brc += 1
        elif ch == "}":
            brc = max(0, brc - 1)
        elif ch == "<":
            ang += 1
        elif ch == ">" and not _is_arrow_gt(inner, i):
            ang = max(0, ang - 1)
        elif ch == ";" and par == brk == brc == ang == 0:
            item = inner[start:i].strip()
            if item:
                items.append(item)
            start = i + 1

    tail = inner[start:].strip()
    if tail:
        items.append(tail)

    props: Dict[str, Tuple[str, bool]] = {}
    for item in items:
        if item.startswith("["):  # index signature
            continue
        if item.startswith("..."):  # spread
            continue

        m = re.match(r"^([A-Za-z0-9_]+)\s*(\?)?\s*:\s*(.+)$", item)
        if not m:
            continue
        key = m.group(1)
        optional = m.group(2) == "?"
        ts_type = m.group(3).strip()
        props[key] = (ts_type, not optional)

    return props


def _collect_props(expr: str, aliases: Dict[str, str]) -> Dict[str, Tuple[str, bool]]:
    """Collect props from an intersection type expression."""
    out: Dict[str, Tuple[str, bool]] = {}

    for term in _split_top_level(expr, "&"):
        term = term.strip()
        if not term:
            continue

        if term.startswith("{"):
            # find matching "}" for the first "{"
            # (object literal may include nested braces; we scan depth)
            depth = 0
            in_bt = in_sq = in_dq = False
            for i, ch in enumerate(term):
                if ch == "`" and not in_sq and not in_dq:
                    in_bt = not in_bt
                    continue
                if ch == "'" and not in_bt and not in_dq:
                    in_sq = not in_sq
                    continue
                if ch == '"' and not in_bt and not in_sq:
                    in_dq = not in_dq
                    continue
                if in_bt or in_sq or in_dq:
                    continue

                if ch == "{":
                    depth += 1
                elif ch == "}":
                    depth -= 1
                    if depth == 0:
                        obj = term[: i + 1]
                        out.update(_parse_object_literal(obj))
                        break
            continue

        # Follow simple aliases used in the expression (e.g. EventHandlers).
        if re.fullmatch(r"[A-Za-z0-9_]+", term) and term in aliases:
            out.update(_collect_props(aliases[term], aliases))

    return out


def _parse_interface_props(src: str, interface_name: str) -> Dict[str, Tuple[str, bool]]:
    """Extract props from an interface definition in a .d.ts file."""
    # Match interface Name<...> extends ... { ... }
    pattern = rf"\binterface\s+{re.escape(interface_name)}(?:<[^>]*>)?(?:\s+extends\s+[^{{]+)?\s*\{{"
    match = re.search(pattern, src)
    if not match:
        return {}

    # Find the matching closing brace
    brace_start = match.end() - 1
    depth = 1
    idx = brace_start + 1
    while idx < len(src) and depth > 0:
        if src[idx] == "{":
            depth += 1
        elif src[idx] == "}":
            depth -= 1
        idx += 1

    body = src[brace_start : idx]
    return _parse_object_literal(body)


def parse_external_type(dist_dir: Path, include_spec: str) -> Dict[str, Tuple[str, bool]]:
    """Parse a type/interface from an external .d.ts file.

    include_spec format: "path/to/file.d.ts:TypeName"
    """
    if ":" not in include_spec:
        return {}

    file_path, type_name = include_spec.rsplit(":", 1)
    dts_path = dist_dir / file_path
    if not dts_path.exists():
        print(f"Warning: External type file not found: {dts_path}")
        return {}

    src = dts_path.read_text(encoding="utf-8")

    # Try interface first
    props = _parse_interface_props(src, type_name)
    if props:
        return props

    # Try type alias
    aliases = _extract_type_aliases(src)
    if type_name in aliases:
        return _collect_props(aliases[type_name], aliases)

    return {}


def parse_svelte_dts(dts_path: Path) -> Tuple[List[Prop], List[str], List[str], List[str]]:
    """Parse a *.svelte.d.ts file into prop metadata."""
    src = dts_path.read_text(encoding="utf-8")
    aliases = _extract_type_aliases(src)
    root_expr = _extract_props_root_expr(src)

    js_props = _collect_props(root_expr, aliases)

    props: List[Prop] = []
    callback_props: List[str] = []
    snippet_props: List[str] = []
    dom_props: List[str] = []

    for js_name, (ts_type, required) in sorted(js_props.items()):
        kind = "value"
        if "=>" in ts_type:
            kind = "callback"
            callback_props.append(js_name)
        elif "Snippet" in ts_type:
            kind = "snippet"
            snippet_props.append(js_name)
        elif "HTMLElement" in ts_type or "HTMLDivElement" in ts_type:
            kind = "dom"
            dom_props.append(js_name)

        props.append(
            Prop(
                js_name=js_name,
                py_name=_to_snake(js_name),
                ts_type=ts_type,
                required=required,
                kind=kind,
            )
        )

    return props, callback_props, snippet_props, dom_props


def parse_svelte_dts_with_includes(
    dts_path: Path, dist_dir: Path, include_from: List[str]
) -> Tuple[List[Prop], List[str], List[str], List[str]]:
    """Parse a *.svelte.d.ts file with additional external type includes."""
    # Start with base props from the .svelte.d.ts file
    props, callback_props, snippet_props, dom_props = parse_svelte_dts(dts_path)
    existing_names = {p.js_name for p in props}

    # Parse additional props from external type definitions
    for include_spec in include_from:
        external_props = parse_external_type(dist_dir, include_spec)
        for js_name, (ts_type, required) in external_props.items():
            if js_name in existing_names:
                continue  # Don't override existing props

            kind = "value"
            if "=>" in ts_type:
                kind = "callback"
                callback_props.append(js_name)
            elif "Snippet" in ts_type:
                kind = "snippet"
                snippet_props.append(js_name)
            elif "HTMLElement" in ts_type or "HTMLDivElement" in ts_type:
                kind = "dom"
                dom_props.append(js_name)

            props.append(
                Prop(
                    js_name=js_name,
                    py_name=_to_snake(js_name),
                    ts_type=ts_type,
                    required=required,
                    kind=kind,
                )
            )
            existing_names.add(js_name)

    return props, callback_props, snippet_props, dom_props


def add_extra_props(
    props: List[Prop],
    extra_props: Dict[str, str],
    callback_props: List[str],
) -> None:
    """Add manually-specified extra props to the props list.

    extra_props format: { "prop_name": "ts_type" }
    """
    existing_names = {p.js_name for p in props}
    for js_name, ts_type in extra_props.items():
        if js_name in existing_names:
            continue

        kind = "value"
        if "=>" in ts_type:
            kind = "callback"
            callback_props.append(js_name)

        props.append(
            Prop(
                js_name=js_name,
                py_name=_to_snake(js_name),
                ts_type=ts_type,
                required=True,  # extra_props are assumed required
                kind=kind,
            )
        )


def find_component_dts(dist_dir: Path, key: str) -> Path:
    """Resolve a manifest key to a *.svelte.d.ts file."""
    if "/" in key:
        path = dist_dir / f"{key}.svelte.d.ts"
        if not path.exists():
            raise FileNotFoundError(path)
        return path

    matches = list(dist_dir.rglob(f"{key}.svelte.d.ts"))
    if not matches:
        raise FileNotFoundError(f"No match for {key!r} under {dist_dir}")
    if len(matches) > 1:
        rel = ", ".join(str(p.relative_to(dist_dir)) for p in matches)
        raise RuntimeError(f"Ambiguous key={key!r}. Matches: {rel}. Use a path key.")
    return matches[0]


def _py_type_hint(ts_type: str) -> str:
    """Conservative TS->Python type hint mapper (best-effort)."""
    t = ts_type.strip()

    if t == "string":
        return "str"
    if t == "number":
        return "float"
    if t == "boolean":
        return "bool"
    if t.endswith("[]"):
        inner = t[:-2].strip()
        inner_py = _py_type_hint(inner)
        return f"list[{inner_py}]" if inner_py != "Any" else "list"
    if "Record" in t or "Partial" in t or "ComponentProps" in t:
        return "dict"
    if "Set" in t:
        return "list"
    if "Float32Array" in t:
        return "list[float]"
    if t.startswith("[") and t.endswith("]"):
        return "list"
    if "|" in t:
        # Union type - try to extract the first non-null type
        parts = [p.strip() for p in t.split("|") if p.strip() not in ("null", "undefined")]
        if parts:
            return _py_type_hint(parts[0])
    return "Any"


def _ts_type_to_docstring(ts_type: str) -> str:
    """Convert a TS type to a human-readable docstring description."""
    t = ts_type.strip()

    # Common patterns
    descriptions = {
        "string": "Text value",
        "number": "Numeric value",
        "boolean": "True/False flag",
        "Crystal": "Pymatgen-compatible structure dict with 'lattice' and 'sites'",
        "TrajectoryData": "Trajectory object with 'frames' array of structures",
    }

    for pattern, desc in descriptions.items():
        if pattern in t:
            return desc

    if "[]" in t:
        return "List of values"
    if "Record" in t or "Partial" in t:
        return "Dictionary of key-value pairs"

    return ""


def generate_wrappers(manifest: Dict[str, Any], dist_dir: Path, out_path: Path) -> None:
    components: Dict[str, Any] = manifest.get("components", {})
    if not components:
        raise SystemExit("Manifest has no [components.*] sections")

    lines: List[str] = []
    lines += [
        "# AUTO-GENERATED by scripts/sync_typed_wrappers.py",
        "# DO NOT EDIT MANUALLY",
        "",
        "from __future__ import annotations",
        "",
        "from typing import Any, Optional",
        "",
        "from .MatterViz import MatterViz",
        "",
    ]

    exported: List[str] = []

    for class_name, spec in components.items():
        key = spec.get("key")
        if not key:
            raise SystemExit(f"[components.{class_name}] missing 'key'")

        dts_path = find_component_dts(dist_dir, key)
        include_from = spec.get("include_from", [])
        if include_from:
            props, callback_props, snippet_props, dom_props = parse_svelte_dts_with_includes(
                dts_path, dist_dir, include_from
            )
        else:
            props, callback_props, snippet_props, dom_props = parse_svelte_dts(dts_path)

        # Add any manually-specified extra props
        extra_props = spec.get("extra_props", {})
        if extra_props:
            add_extra_props(props, extra_props, callback_props)

        # Select only "value" props that are JSON-ish and not DOM handles.
        value_props = [
            p for p in props
            if p.kind == "value" and p.js_name not in dom_props and p.js_name != "children"
        ]

        # Conversion defaults inferred from TS types, overridable in manifest.
        auto_set_props = [p.js_name for p in value_props if "Set" in p.ts_type]
        auto_float32_props = [p.js_name for p in value_props if "Float32Array" in p.ts_type]

        default_set_props = spec.get("set_props", auto_set_props)
        default_float32_props = spec.get("float32_props", auto_float32_props)

        # Apply optional alias overrides (python name -> js name)
        alias_overrides: Dict[str, str] = spec.get("aliases", {}) or {}

        # Build mapping python->js, ensuring unique python identifiers
        py_to_js: Dict[str, str] = {}
        used_py: set[str] = set()

        for p in value_props:
            py = p.py_name
            js = p.js_name

            if py in alias_overrides:
                js = alias_overrides[py]

            base_py = py
            suffix = 2
            while py in used_py:
                py = f"{base_py}_{suffix}"
                suffix += 1

            used_py.add(py)
            py_to_js[py] = js

        exported.append(class_name)

        # Docstring
        doc = (spec.get("doc") or "").strip() or f"Typed wrapper for MatterViz component '{key}'."
        lines.append(f"class {class_name}(MatterViz):")
        lines.append('    """' + doc)
        lines.append("")
        lines.append(f"    Underlying MatterViz component key: ``{key}``.")
        lines.append("")
        if callback_props:
            lines.append("    Events")
            lines.append("    ------")
            lines.append("    MatterViz exposes callback props (functions) as events via ``event_props``.")
            lines.append("    For this component, available callback props include:")
            lines.append("        " + ", ".join(callback_props))
            lines.append("")
        if snippet_props:
            lines.append("    Not supported in Dash")
            lines.append("    --------------------")
            lines.append("    Snippet/slot props are omitted from this wrapper:")
            lines.append("        " + ", ".join(snippet_props))
            lines.append("")
        lines.append("    Prop reference (TypeScript)")
        lines.append("    ---------------------------")
        for py, js in py_to_js.items():
            p = next(pp for pp in value_props if pp.js_name == js)
            req = "" if not p.required else " (required in TS)"
            lines.append(f"    - {py} -> {js}: {p.ts_type}{req}")
        lines.append('    """')
        lines.append("")
        # Note: We don't use @_explicitize_args here because MatterViz.__init__
        # already has it, and the decorator doesn't work well when chained.

        # Signature
        sig_parts: List[str] = ["self", "id=None"]
        for py, js in py_to_js.items():
            p = next(pp for pp in value_props if pp.js_name == js)
            hint = _py_type_hint(p.ts_type)
            sig_parts.append(f"{py}: Optional[{hint}] = None")

        sig_parts += [
            "mv_props: Optional[dict] = None",
            "set_props: Optional[list[str]] = None",
            "float32_props: Optional[list[str]] = None",
            "event_props: Optional[list[str]] = None",
            "last_event: Optional[dict] = None",
            "className: Optional[str] = None",
            "style: Optional[dict] = None",
            "**kwargs",
        ]
        lines.append(f"    def __init__({', '.join(sig_parts)}):")
        lines.append("        _mv: dict = {}")
        for py, js in py_to_js.items():
            lines.append(f"        if {py} is not None:")
            lines.append(f"            _mv[{js!r}] = {py}")
        lines.append("        if mv_props:")
        lines.append("            _mv.update(mv_props)")
        lines.append("")
        if default_set_props:
            lines.append("        if set_props is None:")
            lines.append(f"            set_props = {default_set_props!r}")
        if default_float32_props:
            lines.append("        if float32_props is None:")
            lines.append(f"            float32_props = {default_float32_props!r}")
        lines.append("")
        lines.append(
            "        super().__init__(\n"
            "            id=id,\n"
            f"            component={key!r},\n"
            "            mv_props=_mv,\n"
            "            set_props=set_props,\n"
            "            float32_props=float32_props,\n"
            "            event_props=event_props,\n"
            "            last_event=last_event,\n"
            "            className=className,\n"
            "            style=style,\n"
            "            **kwargs,\n"
            "        )"
        )
        lines.append("")

    lines.append(f"__all__ = {exported!r}")
    lines.append("")

    out_path.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--manifest", default="component_manifest.toml")
    ap.add_argument("--matterviz-dist", default="node_modules/matterviz/dist")
    ap.add_argument("--out", default="matterviz_dash_components/typed.py")
    args = ap.parse_args()

    manifest_path = Path(args.manifest)
    dist_dir = Path(args.matterviz_dist)
    out_path = Path(args.out)

    if not manifest_path.exists():
        raise SystemExit(f"Manifest not found: {manifest_path}")

    if not dist_dir.exists():
        raise SystemExit(
            f"MatterViz dist dir not found: {dist_dir}\n"
            "Run `npm install` first, or pass --matterviz-dist."
        )

    manifest = tomllib.loads(manifest_path.read_text(encoding="utf-8"))
    generate_wrappers(manifest=manifest, dist_dir=dist_dir, out_path=out_path)
    print(f"Wrote {out_path}")


if __name__ == "__main__":
    main()
