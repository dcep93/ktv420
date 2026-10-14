# Homepage architecture diagram

The user requested that the architecture diagram from the preceding explanation be placed on the homepage in the approved Multisport theme. Reuse that content and theme directly: downloaded website code and model files feed the local player; Spotify capture, the extension bridge, audio storage and GPU/CPU separation live on the computer. A concise caption states that captured audio stays local.

Use an accessible inline SVG in a matching panel next to the installation card on desktop; stack the panels when the available width requires it. Retain the compact setup/help copy. Match existing theme variables and title-font stack, with amber arrows and brown nodes. No script, remote diagram dependency, extension update, or audio behavior change. SVG viewBox coordinates are intentional fixed diagram geometry; CSS sizing uses rem.

Verify visible layout and text in a browser, check diff whitespace, commit and publish through the existing CI workflow, and verify the live diagram. This is a low-impact presentation addition; no new unit tests are needed.
