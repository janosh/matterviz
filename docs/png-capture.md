# Structure PNG capture

Structure PNG exports wait for the requested isosurface geometry to finish and
for a frame containing it to be submitted before encoding. They use the viewer's
current sampling resolution. A geometry error refuses the export even when older
surfaces remain visible.

Geometry-setting changes, scene unmounts, and a 60-second preparation timeout
cancel a pending capture. Concurrent captures are refused. Failed preparation,
rendering, and encoding release the capture and restore the drawing buffer so
the viewer remains usable. Empty surfaces and scenes without volumes are valid.

The scene registers its preparation callback alongside the renderer and camera.
The existing post-render task resolves the waiter; there is no polling loop.
Scene-model and video exports keep their existing behavior.
