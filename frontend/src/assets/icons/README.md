# Icon Organization Guide

This folder is organized by UI role and interface area.

## Directory layout

- `layout/header`: header-only icons (brand and nav actions).
- `layout/footer`: footer contact icons.
- `layout/footer/social`: footer social network icons.
- `booking`: booking flow icons (pickup, destination, schedule, swap).
- `home/services`: service category icons used in the home service section.
- `home/promotions`: promotion badge/banner icons in home page cards.
- `home/testimonials`: testimonial quote and star icons.
- `assistant`: assistant/chatbot icons.
- `shared`: reusable cross-interface icons.
- `vehicles`: generic transport icons not tied to one interface.
- `backgrounds`: icon-like image assets used as UI backgrounds.

## Usage rule

Always import from `src/assets/icons/index.js` (barrel export), not from nested paths.

## Naming rule

- Keep existing public export names stable in `index.js`.
- New icon file names should be lowercase, hyphen-separated.
- Place an icon under `shared` only if it is used in 2+ interface areas.
