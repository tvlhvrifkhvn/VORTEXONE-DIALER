---
name: vortex-ui
description: Use for any frontend UI work in Vortex One Outreach (frontend/src), such as new screens, restyling, components and layout. Applies the Neo-Swiss design rules in docs/DESIGN.md.
---
# Vortex One Outreach UI
1. Read docs/DESIGN.md before changing any UI, and follow it exactly. Log each new decision as one line in docs/DECISIONS.md.
2. Build from the primitives in src/components/ui/, all shown on /styleguide: NeuCard (Panel), NeuButton (Button), NeuInput (Field), Badge (Tag), Keycap, SectionLabel, FileTag, StatusDot, Meter, Segmented, Dialog and StatCard (Stat). R7 renames the first three to Panel, Button and Field.
3. Visual work never changes hooks, lib/, API calls, handlers or the backend.
4. Before finishing:
   - Run `cd frontend && npm run build && npm run contrast`.
   - Screenshot the pages you touched in both themes with `node audit/scripts/reskin-shots.js`.
