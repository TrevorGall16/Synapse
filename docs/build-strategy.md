# Build strategy

## Fonts

Geist Sans and Geist Mono are vendored in `public/fonts/` so that
`npm run build` is hermetic: no outbound fetch to Google Fonts, no
flaky CI when upstream is slow, identical bundle output across
developer machines and CI.

- **Source:** `geist` npm package (pinned as a devDependency in
  `package.json`) — `node_modules/geist/dist/fonts/geist-{sans,mono}/`.
  Current version at vendor time: **1.7.0**.
- **License:** SIL Open Font License 1.1 (OFL-1.1) — bundled under
  `node_modules/geist/LICENSE.TXT`.
- **Variants shipped:** variable-width WOFF2, single file per family
  (`geist-sans.woff2`, `geist-mono.woff2`, copied from
  `Geist-Variable.woff2` and `GeistMono-Variable.woff2`). Covers
  weights 100–900.

### Rotation procedure

```bash
npm install --save-dev geist@latest
cp node_modules/geist/dist/fonts/geist-sans/Geist-Variable.woff2     public/fonts/geist-sans.woff2
cp node_modules/geist/dist/fonts/geist-mono/GeistMono-Variable.woff2 public/fonts/geist-mono.woff2
```

Then bump the version number above and run a visual diff against the
old build (body text + any heading weights) before committing.

### Rollback

Revert `app/layout.tsx` to:

```ts
import { Geist, Geist_Mono } from "next/font/google";
const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
```

and delete `public/fonts/`. The `next/font/google` loader will resume
the fetch-on-build behavior.
