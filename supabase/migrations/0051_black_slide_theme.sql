-- Plain black slide theme
-- Migration 0051
--
-- Every theme in the catalog has a point of view — navy and gold, cream and
-- charcoal, purple and silver. Churches projecting onto a wall, a bedsheet or
-- a washed-out sanctuary screen kept asking for the one that has none: black
-- background, white letters, nothing else to fight the room.

INSERT INTO public.slide_themes (
  id, name, description, category, tags, background_type, bg, bg_css,
  text_color, accent_color, font_head, font_body, italic_ref, featured, sort_order
) VALUES (
  'black', 'Black',
  'Pure black with white type — maximum contrast on any screen',
  'minimal',
  ARRAY['black','white','high-contrast','plain','projector','sans-serif'],
  'solid', '000000', '#000000', 'FFFFFF', 'FFFFFF', 'Calibri', 'Calibri', false, true, 7
)
ON CONFLICT (id) DO UPDATE SET
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  tags = excluded.tags,
  background_type = excluded.background_type,
  bg = excluded.bg,
  bg_css = excluded.bg_css,
  text_color = excluded.text_color,
  accent_color = excluded.accent_color,
  font_head = excluded.font_head,
  font_body = excluded.font_body,
  italic_ref = excluded.italic_ref,
  featured = excluded.featured,
  sort_order = excluded.sort_order,
  active = true;
