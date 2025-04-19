<section id="colorbar-auto-placement">
  <h2>ColorBar Auto Placement</h2>
  <p>ColorBar automatically positions itself in the least dense quadrant.</p>
  <div class="plot-grid">
    <div id="colorbar-top-left" class="plot-container">
      <h3>Top Left Placement</h3>
      <ScatterPlot
        series={top_left_series}
        x_lim={[0, 100]}
        y_lim={[0, 100]}
        padding={{ t: 10, b: 40, l: 40, r: 10 }}
        color_bar={{ label: `TL Bar`, tick_labels: 3 }}
        show_color_bar
      />
    </div>
    <div id="colorbar-top-right" class="plot-container">
      <h3>Top Right Placement</h3>
      <ScatterPlot
        series={top_right_series}
        x_lim={[0, 100]}
        y_lim={[0, 100]}
        padding={{ t: 10, b: 40, l: 40, r: 10 }}
        color_bar={{ label: `TR Bar`, tick_labels: 3 }}
        show_color_bar
      />
    </div>
    <div id="colorbar-bottom-left" class="plot-container">
      <h3>Bottom Left Placement</h3>
      <ScatterPlot
        series={bottom_left_series}
        x_lim={[0, 100]}
        y_lim={[0, 100]}
        padding={{ t: 10, b: 40, l: 40, r: 10 }}
        color_bar={{ label: `BL Bar`, tick_labels: 3 }}
        show_color_bar
      />
    </div>
    <div id="colorbar-bottom-right" class="plot-container">
      <h3>Bottom Right Placement</h3>
      <ScatterPlot
        series={bottom_right_series}
        x_lim={[0, 100]}
        y_lim={[0, 100]}
        padding={{ t: 10, b: 40, l: 40, r: 10 }}
        color_bar={{ label: `BR Bar`, tick_labels: 3 }}
        show_color_bar
      />
    </div>
  </div>
</section>

<style>
  /* ... existing style ... */
</style>
