"""JupyterLab file viewer for MatterViz.

Ships no Python API. The package exists so the prebuilt labextension assets get a
home on PyPI; rendering happens entirely in the browser. JupyterLab finds those
assets under ``{sys.prefix}/share/jupyter/labextensions``, not through this module.
"""
