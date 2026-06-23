# Slide theme import format

FaithForm scripture slide decks use themes from two sources:

1. **Solid-color fallbacks** in [`data/slide-themes.json`](../data/slide-themes.json) (bundled JSON)
2. **Photo + catalog themes** in Supabase `slide_themes` + `sermon-themes` storage (Simple Sermon Builder theme picker)

## Solid themes (JSON)

```bash
npm run validate:themes
```

### JSON structure

```json
{
  "version": 1,
  "themes": [
    {
      "id": "midnight-gold",
      "name": "Midnight Gold",
      "description": "Deep navy with gold accents — dramatic and reverent",
      "category": "traditional",
      "tags": ["navy", "gold", "serif", "evening", "formal"],
      "bg": "0E1428",
      "bgCss": "#0E1428",
      "text": "F8FAFC",
      "accent": "C9A227",
      "fontHead": "Georgia",
      "fontBody": "Georgia",
      "italicRef": true,
      "featured": true
    }
  ]
}
```

### Field reference (JSON)

| Field | Required | Notes |
|-------|----------|-------|
| `id` | yes | Unique kebab-case; saved on sermons as `theme_id` — do not rename after publish |
| `name` | yes | Display name in the theme picker |
| `description` | yes | One line shown under the name |
| `category` | yes | `traditional`, `contemporary`, `seasonal`, `minimal`, `bold`, or `nature` |
| `tags` | yes | Lowercase strings for search (colors, occasions, church style) |
| `bg` | yes | 6-character hex **without** `#` — used in PowerPoint export (solid only) |
| `bgCss` | yes | CSS background for in-app preview (`#hex` or `linear-gradient(...)`) |
| `text` | yes | Body text hex without `#` |
| `accent` | yes | Accent hex without `#` |
| `fontHead`, `fontBody` | yes | PowerPoint-safe fonts (Georgia, Calibri, Times New Roman, Arial, etc.) |
| `italicRef` | no | Optional legacy styling hint |
| `featured` | no | When true, theme appears in the Featured section when no search is active |

### Rules

- Hex in `bg`, `text`, `accent`: uppercase or lowercase, no `#` prefix
- `bgCss` for solid colors: include `#` (e.g. `"#0E1428"`)
- For gradients in `bgCss`, set `bg` to the dominant solid color used in the export
- `id` values must be unique across the entire `themes` array
- Use 3–8 tags per theme; keep tags lowercase

## PWPT bulk photo import

Import Pexels photo backgrounds into the Simple Sermon Builder library.

### Prerequisites

1. Migration `0021_slide_themes.sql` applied (creates `slide_themes` table):

   ```bash
   DATABASE_URL="postgresql://postgres.[ref]:[password]@...pooler.supabase.com:6543/postgres" pnpm db:slide-themes
   ```

2. Env vars for upload: `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SECRET_KEY`

### Commands

```bash
# 1. Generate optimized JPEGs + manifest from ~/Downloads/PWPT Themes
npm run generate:pwpt-themes

# 2. Upload images to sermon-themes bucket + upsert slide_themes rows
npm run import:themes data/pwpt-themes-manifest.json
```

Optional custom paths:

```bash
node scripts/generate-pwpt-theme-manifest.mjs "/path/to/PWPT Themes" "data/sermon-theme-import"
```

### What the generator does

- Skips duplicate ` (1).jpg` copies
- Resizes to max 1920px wide, JPEG ~82% quality, target &lt; 4.5MB (Supabase bucket limit is 5MB)
- Samples center region colors for readable text:
  - **Dark backgrounds** → white text (`F8FAFC`), warm gold accent
  - **Light backgrounds** → charcoal text (`1C1917`), navy/burgundy/green accent
- Assigns **PowerPoint-safe fonts** by category:
  - `traditional` / `bold` → Georgia
  - `nature` / `contemporary` → Calibri
  - `minimal` → Arial
- Sets `text_shadow: true` for in-app overlay + PPTX export shadow
- Writes [`data/pwpt-themes-manifest.json`](../data/pwpt-themes-manifest.json) (committed)
- Stages optimized images in `data/sermon-theme-import/` (gitignored)

### Photo manifest fields

See [`scripts/import-slide-themes.mjs`](../scripts/import-slide-themes.mjs) for the full manifest schema. Key fields:

| Field | Notes |
|-------|-------|
| `file` | Path relative to manifest dir, e.g. `./sermon-theme-import/pexels-foo.jpg` |
| `text_color`, `accent_color` | 6-char hex without `#` |
| `visual_style` | Use `["photographic"]` for PWPT imports |
| `text_shadow` | `true` for photo backgrounds |
| `featured` | `false` keeps existing solid themes in Featured |
| `sort_order` | `100+` sorts photos after solid themes |

### After import

1. Open Simple Sermon Builder → theme picker shows all themes
2. Filter by **photographic** visual style or search `photo`
3. Export PPTX — image themes include text shadow for readability

## Spreadsheet bulk import (solid themes)

One row per theme. Map columns to JSON fields; `tags` as comma-separated values.

Example columns: `id`, `name`, `description`, `category`, `tags`, `bg`, `bgCss`, `text`, `accent`, `fontHead`, `fontBody`, `featured`

## After adding solid JSON themes

1. Run `npm run validate:themes`
2. Fix any reported errors
3. Commit `data/slide-themes.json`
4. New themes appear in Sermon Builder → Slide theme (searchable) when DB catalog is empty; production uses Supabase catalog when `slide_themes` has rows

