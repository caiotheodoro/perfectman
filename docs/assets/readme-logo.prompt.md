# Perfectman image notes

The README uses `readme-logo.png` beside the project name.
The PNG file has a transparent background.
GitHub sets the text color for the page theme.

The built-in imagegen tool made this image from the previous project header.
The image is a project symbol. It does not show a test result.
The final PNG is 256 pixels wide and 256 pixels high.
The resize operation kept the alpha channel.

## Image prompt

Use case: background-extraction
Edit target: the supplied Perfectman header.
Extract only the three-agent symbol at the left. Remove the white background and all wordmark text. Preserve the three shapes, their colors, positions, proportions, and eyes. Use a tight square canvas with a small clear margin.
Use a real transparent background with an alpha channel. Keep the white eyes inside the two foreground agents opaque. Keep the gray agent and its dark eyes opaque.
Add only a very thin medium-gray outline around the charcoal foreground agent. This outline must make that agent visible on both white and near-black page backgrounds. Keep the outline small and simple. Do not add a background panel.
Do not draw a checkerboard, shadow, border around the canvas, or new detail. This symbol will appear beside normal title text on a GitHub README.
