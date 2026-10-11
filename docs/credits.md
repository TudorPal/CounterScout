# Credits and provenance

## Starting project

CounterScout started from [Twoos123/cs2-meta-engine](https://github.com/Twoos123/cs2-meta-engine).
Thanks to its author and contributors for the initial application structure,
demo-analysis foundation and HLTV import workflow.

CounterScout substantially extends and fixes that foundation: FACEIT team
history and browser imports, FACEIT/ESEA demo compatibility, roster editing and
batch naming, replay/parser fixes, multi-demo team insights, redesigned
workspaces, evidence-based structured AI scouting, and portable Windows builds.
The upstream project also has FACEIT features; this credit does not claim that
all FACEIT support originated in CounterScout.

## Libraries and services

- [demoparser2](https://github.com/LaihoE/demoparser): LaihoE's Rust CS2 demo parser; MIT-licensed library.
- [awpy](https://github.com/pnxenopoulos/awpy): CS2 analysis framework and original radar/calibration foundation; MIT-licensed code. This does not establish the licence of game artwork.
- [FACEIT](https://developers.faceit.com/): Data/Downloads API integration and demo/match sources. The keyless bridge uses the user's signed-in browser and downloaded files. FACEIT terms still apply.
- [HLTV.org](https://www.hltv.org/): match pages, demos, rosters and logos. CounterScout currently has a server-side HLTV importer; its included browser extension is a FACEIT bridge, not an HLTV extension. Credits do not imply affiliation or unrestricted reuse.
- [Liquipedia](https://liquipedia.net/): the upstream project acknowledges its match catalog and appropriately licensed photos. Those integrations and per-image attribution are not present in this checkout. Do not label CounterScout's current HLTV photos as CC-BY-SA. If Liquipedia content is added, preserve each file's actual author, source, licence and required attribution; do not assume every photo has the same licence.
- CS2Callouts: original callout extraction reference.
- Groq and OpenRouter: optional third-party AI services; compact evidence is sent only after user consent.
- Other Python/frontend dependencies: their respective authors and licences. Portable builds preserve discovered dependency licence notices under `third-party-licenses/`.
- 7-Zip: bundled archive tools, licence and matching source under `tools/`.

## Maps and images

Current grayscale radar PNGs were supplied from the user's GreyscaleMaps asset
set; existing calibration is retained. Nuke currently uses the upper radar.
Game artwork, radar images, weapon icons, team logos and player photos are not
relicensed under MIT. Review their individual provenance and redistribution
terms; do not infer asset permissions from awpy's code licence.

See the root [licensing notice](../NOTICE.md). CounterScout is not affiliated
with Valve, FACEIT, HLTV, Liquipedia or credited projects.
