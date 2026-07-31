# Trademark & Brand Policy

**Short version: the code is open. The brand is not.**

FATE's source code is released under the [MIT License](LICENSE) — fork it, modify it, ship it,
sell it. That permission covers **code**. It does not, and was never intended to, hand over the name
or the artwork.

This file exists because MIT is a *copyright* licence. It says nothing about trademarks, and it is
routinely misread as granting the whole identity along with the source. It doesn't.

---

## Owned by VagueDustin Enterprises

The following are the property of **VagueDustin Enterprises** and are **not** covered by the MIT
licence:

| | |
| --- | --- |
| **Names & marks** | "FATE", "Formatted Article & Text Explorer", "VagueDustin Enterprises", "VagueDustin", and the ™ forms of each |
| **Artwork** | Everything in `brand/` — the gilded badge (`brand/app-icon.png`), the document mark (`brand/document-icon.png`) — and every icon derived from them: `build/icon.ico`, `build/icon-doc.ico`, `build/appx/*`, `src/assets/FATE-Square-Icon.png`, `public/favicon.png` |
| **Wordmark treatment** | The FATE wordmark as set — Cinzel, letterspaced, gold-gradient-filled |
| **Design language** | The VagueDustin Enterprises navy-and-gold identity as expressed in `src/brand.css`, including the palette, the ornament conventions, and the publisher credit line |

All rights in these are reserved.

---

## What you may do

- **Fork the repository** and keep the marks in place *in your fork*, so it's clear where the code
  came from. That's what forks are for.
- **Submit pull requests.** See [CONTRIBUTING.md](CONTRIBUTING.md).
- **Refer to FATE by name** factually — "a patch for FATE", "compatible with FATE", "based on FATE".
  Nominative reference doesn't need permission.
- **Build and run your own modified copy** for yourself, your team, or your organisation.
- **Reuse the code** in your own project under MIT, with your own name and your own artwork.

## What you may not do without written permission

- **Distribute or publish** a modified build that still carries the FATE name, the badge, the
  document mark, or the VagueDustin Enterprises credit. Rename it and use your own artwork.
- **Publish to an app store or package registry** under the FATE name — Microsoft Store, winget,
  Chocolatey, Scoop, npm, or anywhere else.
- **Register** a domain, social account, organisation, or repository whose name implies it is the
  official FATE or an official VagueDustin Enterprises property.
- **Reuse the artwork** in `brand/` (or anything derived from it) in another product, at any scale or
  recolour.
- **Imply endorsement, affiliation, or partnership** with FATE or VagueDustin Enterprises.

---

## Forking, concretely

Forking is welcome. If you plan to **distribute** your fork, change three things first:

1. **The name** — `productName` and `build.appId` in `package.json`, and the display strings in
   `src/App.jsx` and `electron/main.cjs`.
2. **The artwork** — replace both masters in `brand/`, then run `npm run icons`.
3. **The publisher credit** — remove the "Provided by VagueDustin Enterprises™" line, and drop
   `build.appx.publisherDisplayName`.

Keep the MIT licence and the copyright notice on the code you reuse. That's the only obligation the
licence puts on you, and it stays.

---

## Contributions

By opening a pull request you agree that your contribution is licensed under the MIT License, and
that you have the right to license it. You keep the copyright in what you wrote.

Contributions to the code do **not** transfer any interest in the marks or artwork above, and do not
create a claim to them.

---

## Asking

Wanting to do something on the "not without permission" list is not a problem — just ask first.
Open an issue, or reach out through the links on [vaguedustin.com](https://vaguedustin.com).

*This document is a plain-language statement of how these marks may be used. It is not legal advice,
and it does not limit any rights VagueDustin Enterprises holds under applicable law.*

---

*FATE and VagueDustin Enterprises are trademarks of VagueDustin Enterprises.*
