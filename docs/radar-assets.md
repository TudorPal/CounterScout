# Radar assets

The greyscale PNGs for Ancient, Anubis, Cache, Dust2, Inferno, Mirage and
Nuke's upper level were copied from `GreyscaleMaps/t2`. The source files were
left untouched. Nuke's lower-level replacement is intentionally not included.

All seven retain their original 1024×1024 coordinate registration, so the
world-to-image calibration in `map-data.json` is unchanged. Other map PNGs
remain available; the frontend renders all base radar images in greyscale,
without desaturating coloured player, grenade or heatmap overlays.

Radar metadata returns a versioned `image_url` to avoid reusing coloured
images cached before this change. When replacing assets again, increment its
version in `backend/main.py`. The portable build includes this directory.
