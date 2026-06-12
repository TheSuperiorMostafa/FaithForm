-- Slide themes catalog (global, platform-wide image/color themes for simple sermon decks)

CREATE TABLE IF NOT EXISTS public.slide_themes (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'contemporary',
  tags text[] NOT NULL DEFAULT '{}',
  seasonal_tags text[] NOT NULL DEFAULT '{}',
  symbol_tags text[] NOT NULL DEFAULT '{}',
  visual_style text[] NOT NULL DEFAULT '{}',
  background_type text NOT NULL DEFAULT 'solid'
    CHECK (background_type IN ('solid', 'image')),
  image_path text,
  bg text,
  bg_css text,
  text_color text NOT NULL DEFAULT 'FFFFFF',
  accent_color text NOT NULL DEFAULT 'C9A227',
  font_head text NOT NULL DEFAULT 'Georgia',
  font_body text NOT NULL DEFAULT 'Georgia',
  italic_ref boolean NOT NULL DEFAULT false,
  text_shadow boolean NOT NULL DEFAULT false,
  featured boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS slide_themes_active_idx ON public.slide_themes (active, sort_order);
CREATE INDEX IF NOT EXISTS slide_themes_category_idx ON public.slide_themes (category);

ALTER TABLE public.slide_themes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS slide_themes_select ON public.slide_themes;
CREATE POLICY slide_themes_select ON public.slide_themes
  FOR SELECT TO anon, authenticated
  USING (active = true);

-- Seed legacy solid-color themes from slide-themes.json
INSERT INTO public.slide_themes (
  id, name, description, category, tags, background_type, bg, bg_css,
  text_color, accent_color, font_head, font_body, italic_ref, featured, sort_order
) VALUES
  (
    'midnight', 'Midnight',
    'Deep navy with gold accents — dramatic and reverent',
    'traditional', ARRAY['navy','gold','serif','evening','formal','dramatic'],
    'solid', '0E1428', '#0E1428', 'F8FAFC', 'C9A227', 'Georgia', 'Georgia', true, true, 1
  ),
  (
    'ivory', 'Ivory Classic',
    'Warm cream with charcoal type — timeless and readable',
    'traditional', ARRAY['cream','light','serif','readable','classic','neutral'],
    'solid', 'FAF7F2', '#FAF7F2', '1C1917', '78716C', 'Georgia', 'Georgia', false, true, 2
  ),
  (
    'sunrise', 'Sunrise',
    'Soft coral gradient feel — warm and inviting',
    'contemporary', ARRAY['coral','warm','gradient','morning','inviting','sans-serif'],
    'solid', 'FFF1E6', 'linear-gradient(135deg, #FFF1E6 0%, #FFD6BA 100%)', '431407', 'C2410C', 'Calibri', 'Calibri', false, true, 3
  ),
  (
    'forest', 'Forest',
    'Deep green with sage text — calm and grounded',
    'nature', ARRAY['green','earth','calm','outdoor','grounded','sans-serif'],
    'solid', '1A2E1A', '#1A2E1A', 'E8F0E8', '86A87A', 'Calibri', 'Calibri', false, false, 4
  ),
  (
    'cathedral', 'Cathedral Stone',
    'Stone gray with burgundy accents — traditional',
    'traditional', ARRAY['stone','burgundy','liturgical','serif','formal','classic'],
    'solid', 'E8E4DF', '#E8E4DF', '292524', '7F1D1D', 'Times New Roman', 'Times New Roman', true, false, 5
  ),
  (
    'royal', 'Royal Velvet',
    'Rich purple with silver type — bold and elegant',
    'bold', ARRAY['purple','elegant','bold','serif','evening','dramatic'],
    'solid', '2D1B4E', '#2D1B4E', 'F1E8FF', 'C4B5FD', 'Georgia', 'Georgia', true, false, 6
  )
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- STORAGE: sermon-themes bucket (public read)
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'sermon-themes',
  'sermon-themes',
  true,
  5242880,
  ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

CREATE POLICY "Public read access for sermon themes"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'sermon-themes');
