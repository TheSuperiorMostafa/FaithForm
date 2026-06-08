# Slide theme import format

FaithForm scripture slide decks use themes from [`data/slide-themes.json`](../data/slide-themes.json). Add or edit themes in that file, then run:

```bash
npm run validate:themes
```

## JSON structure

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

## Field reference

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

## Rules

- Hex in `bg`, `text`, `accent`: uppercase or lowercase, no `#` prefix
- `bgCss` for solid colors: include `#` (e.g. `"#0E1428"`)
- For gradients in `bgCss`, set `bg` to the dominant solid color used in the export
- `id` values must be unique across the entire `themes` array
- Use 3–8 tags per theme; keep tags lowercase

## Spreadsheet bulk import

One row per theme. Map columns to JSON fields; `tags` as comma-separated values.

Example columns: `id`, `name`, `description`, `category`, `tags`, `bg`, `bgCss`, `text`, `accent`, `fontHead`, `fontBody`, `featured`

## After adding themes

1. Run `npm run validate:themes`
2. Fix any reported errors
3. Commit `data/slide-themes.json`
4. New themes appear in Sermon Builder → Slide theme (searchable)
