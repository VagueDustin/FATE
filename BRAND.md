# Brand & Artwork Policy

**Short version: the code is open. The name and the artwork are mine.**

FATE's source code is released under the [AGPL-3.0](LICENSE) — read it, fork it, improve it, and
distribute your changes with their source. That licence covers **code**. It does not hand over the
name or the artwork, and it was never intended to.

**To be plain about what these are:** nothing here is a registered trademark. "VagueDustin
Enterprises" is my brand, "VagueDustin" is my alias, and FATE is a project I make under that name.
Rights in a name come from actually using it, and artwork is protected by copyright from the moment
it's drawn — no registry paperwork involved. Where a ™ appears, it marks an unregistered brand,
which is exactly what that symbol is for.

So this document isn't a legal threat. It's a clear statement of what I'm happy for you to do, and
the few things I'd rather you didn't.

---

## Not covered by the AGPL

| | |
| --- | --- |
| **Names** | "FATE", "Formatted Article & Text Editor", "VagueDustin Enterprises", "VagueDustin" |
| **Artwork** | Everything in `brand/` — the gilded badge (`brand/app-icon.png`), the document mark (`brand/document-icon.png`) — and every asset derived from them: `build/icon.ico`, `build/icon-doc.ico`, `build/fileicons/*`, `build/appx/*`, `build/store-art/*`, `src/assets/FATE-Square-Icon.png`, `public/favicon.png` |
| **Wordmark treatment** | The FATE wordmark as set — Cinzel, letterspaced, gold-gradient-filled |
| **Design language** | The VagueDustin Enterprises navy-and-gold identity as expressed in `src/brand.css`, including the palette, the ornament conventions, and the publisher credit line |

These are rights-reserved. The AGPL applies to the source code; it does not license the artwork or
the name along with it.

---

## What you may do

- **Fork the repository** and keep the name and artwork in place *in your fork*, so it's clear where
  the code came from. That's what forks are for.
- **Submit pull requests.** See [CONTRIBUTING.md](CONTRIBUTING.md).
- **Refer to FATE by name** factually — "a patch for FATE", "compatible with FATE", "based on FATE".
  That needs no permission.
- **Build and run your own modified copy** for yourself, your team, or your organisation.
- **Reuse the code** in your own project under the AGPL, with your own name and your own artwork.

## What I'd ask you not to do without asking first

- **Distribute or publish** a modified build that still carries the FATE name, the badge, the
  document mark, or the VagueDustin Enterprises credit. Rename it and use your own artwork.
- **Publish under the FATE name** to an app store or package registry — Microsoft Store, winget,
  Chocolatey, Scoop, npm, or anywhere else.
- **Register** a domain, social account, organisation, or repository whose name implies it is the
  official FATE or an official VagueDustin Enterprises property.
- **Reuse the artwork** in `brand/` (or anything derived from it) in another product, at any scale or
  recolour.
- **Imply endorsement, affiliation, or partnership** with FATE or VagueDustin Enterprises.

---

## Forking, concretely

Forking is welcome. If you plan to **distribute** your fork, change four things first:

1. **The name** — in `package.json`: `build.productName`, `build.executableName`, `build.appId`,
   `build.nsis.shortcutName`, and the `build.appx.*` block. In code: `APP_TITLE` in
   `electron/main.cjs`, the display strings in `src/App.jsx`, and `<title>` in `index.html`.
2. **The artwork** — replace both masters in `brand/`, then run `npm run icons` (and
   `node scripts/generate-store-art.mjs` if you're publishing to a store).
3. **The publisher credit** — remove the "Provided by VagueDustin Enterprises" line from
   `src/App.jsx` (home screen and the About panel), and drop `build.appx.publisherDisplayName`.
4. **The Windows identity** — `build/installer.nsh` registers `Software\FATE\Capabilities`, the
   `FATE.CodeFile` / `FATE.<ext>` ProgIds, and an "Edit in FATE" shell verb. Rename those too, or
   your fork and FATE will fight over the same file associations on the same machine.

And keep the AGPL: your distributed fork's complete source has to be available under the same
licence. That's the deal the code comes with.

---

## Contributions

By opening a pull request you agree that your contribution is licensed under the AGPL-3.0, that you
have the right to license it, and that VagueDustin Enterprises may relicense the project (including
your contribution) under other terms in future. You keep the copyright in what you wrote.

Contributing code does **not** grant any rights in the name or artwork above.

---

## Asking

Wanting to do something on the "please ask first" list is not a problem — just ask. Open an issue,
or reach out through the links on [vaguedustin.com](https://vaguedustin.com).

*This is a plain-language statement of how the FATE name and artwork may be used. It isn't legal
advice, and it doesn't limit any rights held under applicable law.*
