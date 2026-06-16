# Penumbral Icons

Builds app-specific custom emoji assets that remain usable across light and dark UI themes.

[penumbral-icons.maurice-frank.com](https://penumbral-icons.maurice-frank.com)

## Usage

```bash
npm install
npm run build
```

## Config

- `config/icons.json`: icon registry, source hints, and render strategy
- `config/profiles.json`: app profiles with background and foreground colors

## Output

- `dist/notion/emoji/`: upload-ready Notion PNGs
- `dist/linear/emoji/`: upload-ready Linear PNGs
- `dist/svg-auto/`: theme-aware SVG variants for icons using `auto-svg`
- `dist/reports/manifest.json`: per-icon build report

## Source Handling

- Primary source layer: LobeHub metadata and static icon CDN
- Secondary fallback: `simple-icons`
- Additional fallback: configured official SVG URLs or cached local source SVGs in `assets/source/`
