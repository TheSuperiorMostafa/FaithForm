#!/usr/bin/env node
/**
 * Seeds the church websites.
 *
 *   DATABASE_URL="postgresql://..." pnpm seed:demo-sites
 *
 * Louisville Grace is Template #1: the mock's design rendered from the REAL
 * client row that already exists in this database. Its profile, staff, service
 * times and events are never written to -- the whole point is to show that the
 * site is a view over data the church already maintains in the dashboard.
 * Only the website config (site_* tables) is created.
 *
 * Riverbend Chapel is the proof that one codebase serves many: same components,
 * different theme, different section order, one section hidden, one patched
 * through site_overrides. It is a fabricated church, so it is easy to remove.
 *
 * Flags:
 *   --no-demo-church   skip Riverbend entirely (nothing fake enters the db)
 *   --cleanup-demo     delete Riverbend and everything attached to it, then exit
 *
 * Optional: SEED_CONTACT_EMAIL=you@example.com routes contact submissions to an
 * address you can check, instead of the church's real office inbox.
 */
import pg from "pg";

const { Client } = pg;

const SKIP_DEMO = process.argv.includes("--no-demo-church");
const CLEANUP_DEMO = process.argv.includes("--cleanup-demo");
const CONTACT_EMAIL = process.env.SEED_CONTACT_EMAIL?.trim() || null;

const databaseUrl = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;
if (!databaseUrl) {
  console.error(
    "Missing DATABASE_URL. Set Supabase Postgres URI from Dashboard → Settings → Database.",
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// LOUISVILLE GRACE — Template #1
// ---------------------------------------------------------------------------

const GRACE = {
  // Binds to the church that already exists in this database rather than
  // creating a second row for the same congregation.
  matchSlug: "grace-community-church-11111111",
  create: false,
  themeKey: "grace",
  hostname: "louisville-grace.faithform.io",
  media: [
    {
      title: "Room For One More",
      series: "The Table",
      speaker: "Pastor Brent Piatt",
      published_at: "2026-06-29",
    },
    {
      title: "When Grace Interrupts",
      series: "The Table",
      speaker: "Pastor Brent Piatt",
      published_at: "2026-06-22",
    },
    {
      title: "Ordinary Miracles",
      series: "Everyday Faith",
      speaker: "Guest Speaker",
      published_at: "2026-06-15",
    },
    {
      title: "The Long Obedience",
      series: "Everyday Faith",
      speaker: "Pastor Brent Piatt",
      published_at: "2026-06-08",
    },
  ],
  page: {
    title: "Louisville Grace | Church of the Nazarene",
    meta_description:
      "A contemporary Nazarene church on Taylorsville Road in Louisville, Kentucky. Sunday worship at 10:45 AM — there's a seat with your name on it.",
  },
  /**
   * Anchors are set explicitly so the nav's #about / #vision / #staff links keep
   * working. Without them each section would fall back to its type name.
   */
  sections: [
    {
      type: "site_nav",
      props: {
        anchor: "top",
        // The church row is named "Grace Community Church of the Nazarene" with
        // denomination "Other". Both are correct for the dashboard and wrong for
        // the masthead, so the display strings are set here instead of editing
        // the profile -- which is exactly what the config layer is for.
        title: "Louisville Grace",
        subtitle: "Church of the Nazarene",
        links: [
          { label: "About", href: "#about" },
          { label: "Vision", href: "#vision" },
          { label: "Staff", href: "#staff" },
          { label: "Programs", href: "#programs" },
          { label: "Sermons", href: "#sermons" },
          { label: "Give", href: "#give" },
        ],
        cta: { label: "Visit", href: "#visit", variant: "solid" },
      },
    },
    {
      type: "hero",
      props: {
        anchor: "top-hero",
        eyebrow: "LOUISVILLE NAZARENE · FAITH, FAMILY & GRACE",
        headline: { lead: "GRACE FOR EVERY", accent: "welcome." },
        body: "A contemporary Nazarene church on Taylorsville Road where doubters, seekers, and lifelong believers gather at one table.",
        actions: [
          { label: "Plan your visit", href: "#visit", variant: "solid" },
          { label: "Latest sermon", href: "#sermons", variant: "outline" },
        ],
        image: {
          src: null,
          alt: "",
          placeholder: "congregation gathered after a Sunday service",
        },
      },
    },
    // Times and address come from the profile via derive(); nothing to configure.
    { type: "service_times", props: { anchor: "times" } },
    {
      type: "about_text",
      props: {
        anchor: "about",
        eyebrow: "Welcome home",
        headline: {
          lead: "However you found your way here, we're",
          accent: "glad",
          trail: "you did.",
        },
        body: [
          "We are a community passionate about worship! People who approach a broken world with God's Truth covered in God's Grace. We believe in salvation made available for all through Christ Jesus. We believe in a life of victory over sin, life abundant in the joy and peace of Christ, and a mission of reconciliation and restoration for our neighbors.",
          "We are Grace Community. We are a community of worship. Hope. Purpose. A community of Grace.",
        ],
        stats: [
          { value: "70+", label: "years on Taylorsville Rd" },
          { value: "3", label: "weekly gatherings" },
          { value: "1", label: "table, room for all" },
        ],
        image: {
          src: null,
          alt: "",
          placeholder: "the church building on Taylorsville Road",
        },
      },
    },
    {
      type: "vision_mission",
      props: {
        anchor: "vision",
        eyebrow: "Why we gather",
        headline: { lead: "Our vision & mission" },
        // The church's stored vision_statement and mission_statement are long
        // multi-paragraph texts written for the AI assistant and internal use.
        // Dropping those straight into two cards buries the page, so the
        // website carries the distilled line the church already uses publicly.
        // The full statements stay untouched in the profile.
        cards: [
          {
            badge: "V",
            title: "Our Vision",
            body: "Live in the river, Go to others, Share the river",
          },
          {
            badge: "M",
            title: "Our Mission",
            body: "To live rested, guided, and empowered by streams of grace in a world longing for peace — and to share this stream of life with others.",
          },
        ],
      },
    },
    {
      type: "staff_grid",
      props: {
        anchor: "staff",
        eyebrow: "The people you'll meet",
        headline: { lead: "Our team" },
        note: "Familiar faces who'd love to know your name. Say hello this Sunday.",
      },
    },
    {
      type: "programs_grid",
      props: {
        anchor: "programs",
        eyebrow: "Every week at Grace",
        headline: { lead: "Find your people" },
        link: { label: "See the full calendar →", href: "#visit" },
        items: [
          {
            badge: "S",
            when: "Sun · 9:45 AM",
            title: "Sunday School",
            body: "Classes for every age — dig into Scripture together before worship.",
          },
          {
            badge: "W",
            when: "Sun · 10:45 AM",
            title: "Morning Worship",
            body: "Contemporary worship, a grounded message, and communion at the table.",
          },
          {
            badge: "M",
            when: "Wed · 6:30 PM",
            title: "Midweek Gathering",
            body: "Prayer, teaching, and mid-week encouragement for the whole family.",
          },
          {
            badge: "K",
            when: "Sun & Wed",
            title: "Grace Kids",
            body: "Nursery through 5th grade — Bible stories, games, and a whole lot of fun.",
          },
          {
            badge: "Y",
            when: "Wed · 6:30 PM",
            title: "Students",
            body: "Middle & high schoolers building real faith and real friendships.",
          },
          {
            badge: "G",
            when: "Various",
            title: "Small Groups",
            body: "Homes across Louisville where life and faith are done together.",
          },
        ],
      },
    },
    {
      type: "visit_cta",
      props: {
        anchor: "visit",
        eyebrow: "First time?",
        headline: { lead: "Know what to expect before you walk in." },
        body: "We'll save you a seat, point you to kids check-in, and there's coffee on the house. Plan your visit and we'll be watching for you.",
        action: { label: "Plan your visit →", href: "", variant: "solid" },
        facts: [
          {
            icon: "⌚",
            title: "Arrive a little early",
            body: "Doors open 30 minutes before — grab coffee and settle in.",
          },
          {
            icon: "★",
            title: "Come as you are",
            body: "Jeans or Sunday best, both fit right in. No dress code.",
          },
          {
            icon: "♥",
            title: "Kids are welcome",
            body: "Safe, secure check-in for nursery through 5th grade.",
          },
          {
            icon: "☕",
            title: "Coffee is on us",
            body: "Say hi at the Welcome Center — we saved you a cup.",
          },
        ],
        form: {
          enabled: true,
          heading: "Let us know you're coming",
          description:
            "Send a note and someone from the team will be watching for you on Sunday.",
          submitLabel: "Send it →",
          successMessage:
            "Thank you — we've got your note, and someone will be in touch before Sunday.",
          consentNote:
            "We'll only use this to get in touch about your visit.",
        },
      },
    },
    {
      type: "sermon_feed",
      props: {
        anchor: "sermons",
        eyebrow: "Watch & listen",
        headline: { lead: "Latest messages" },
        link: { label: "Full archive →", href: "#sermons" },
      },
    },
    {
      type: "give_cta",
      props: {
        anchor: "give",
        eyebrow: "Generosity",
        headline: { lead: "Every gift makes room at the", accent: "table." },
        body: "Your generosity feeds neighbors, funds kids & students, and keeps the doors on Taylorsville Road open to all. Give securely online, in one minute.",
        bullets: ["Secure & encrypted", "One-time or recurring"],
      },
    },
    {
      type: "footer_map",
      props: {
        anchor: "footer",
        title: "Louisville Grace",
        subtitle: "Church of the Nazarene",
        blurb:
          "A come-as-you-are family in Louisville, Kentucky. There's a seat with your name on it.",
        // `columns` is left alone so the Gather block keeps tracking the service
        // times the church edits in the dashboard. Links go in extraColumns.
        extraColumns: [
          {
            heading: "Explore",
            links: [
              { label: "About us", href: "#about" },
              { label: "Sermons", href: "#sermons" },
              { label: "Give", href: "#give" },
              { label: "Plan a visit", href: "#visit" },
            ],
          },
        ],
      },
    },
  ],
  overrides: [],
};

// ---------------------------------------------------------------------------
// RIVERBEND CHAPEL — the proof that one codebase serves both
// ---------------------------------------------------------------------------

const RIVERBEND = {
  matchSlug: "riverbend-chapel",
  create: true,
  themeKey: "classic",
  hostname: "riverbend-chapel.faithform.io",
  // Brand tokens layered over the classic theme, so this church does not look
  // like the stock classic theme either.
  brandTokens: {
    "--site-accent": "#B4763A",
    "--site-ink": "#243447",
    "--site-ink-strong": "#1A2634",
    "--site-gold": "#8C6239",
  },
  profile: {
    name: "Riverbend Chapel",
    denomination: "Community Church",
    tagline: "A quiet place on the river",
    description:
      "A small congregation on the east bank, gathering for unhurried worship, shared meals, and the ordinary work of loving our neighbours.",
    mission_statement:
      "To keep a door open on this street for anyone who needs one.",
    vision_statement: "Rooted people, open doors, a river that keeps moving.",
    address: "812 Riverbend Way",
    city: "Frankfort",
    state: "KY",
    zip: "40601",
    timezone: "America/New_York",
  },
  serviceTimes: [
    { label: "Morning Prayer", day_of_week: 0, start_time: "09:00", kind: "regular" },
    { label: "Sunday Gathering", day_of_week: 0, start_time: "10:30", kind: "regular" },
  ],
  staff: [
    {
      full_name: "Dana Whitfield",
      title: "Pastor",
      bio: "Twenty years on this street, and still learning everyone's coffee order.",
    },
    {
      full_name: "Marcus Ilori",
      title: "Community & Care",
      bio: "Runs the Tuesday meal and knows who has not been seen in a while.",
    },
    {
      full_name: "Ruth Ann Perry",
      title: "Music",
      bio: "Piano, hymnals, and the occasional unscheduled key change.",
    },
  ],
  media: [],
  page: {
    title: "Riverbend Chapel",
    meta_description:
      "A small community church in Frankfort, Kentucky. Sunday gathering at 10:30 AM.",
  },
  /**
   * Same masters, different order: vision leads, about follows, events appear,
   * programs is hidden, and there is no sermon feed at all.
   */
  sections: [
    {
      type: "site_nav",
      props: {
        anchor: "top",
        links: [
          { label: "Vision", href: "#vision" },
          { label: "About", href: "#about" },
          { label: "What's on", href: "#events" },
          { label: "Our people", href: "#staff" },
          { label: "Give", href: "#give" },
        ],
        cta: { label: "Visit", href: "#visit", variant: "solid" },
      },
    },
    {
      type: "hero",
      props: {
        anchor: "top-hero",
        eyebrow: "FRANKFORT, KENTUCKY",
        headline: { lead: "A quiet place", accent: "on the river." },
        body: "Unhurried worship, a shared table, and room for whoever walks in.",
        actions: [{ label: "Plan a visit", href: "#visit", variant: "solid" }],
        image: { src: null, alt: "", placeholder: "the chapel from the riverbank" },
      },
    },
    { type: "service_times", props: { anchor: "times" } },
    { type: "vision_mission", props: { anchor: "vision", eyebrow: "What we are for" } },
    {
      type: "about_text",
      props: {
        anchor: "about",
        eyebrow: "Who we are",
        headline: { lead: "Small, steady, and", accent: "glad", trail: "you came." },
        stats: [
          { value: "40", label: "or so on a good Sunday" },
          { value: "1", label: "very loud kettle" },
        ],
      },
    },
    {
      type: "events_list",
      props: {
        anchor: "events",
        eyebrow: "On the calendar",
        headline: { lead: "What's coming up" },
      },
    },
    {
      type: "staff_grid",
      props: {
        anchor: "staff",
        eyebrow: "Who you'll meet",
        headline: { lead: "Our people" },
      },
    },
    // Hidden rather than deleted: the config is intact if it is wanted back.
    { type: "programs_grid", is_visible: false, props: { anchor: "programs" } },
    {
      type: "visit_cta",
      props: {
        anchor: "visit",
        eyebrow: "Thinking of coming?",
        headline: { lead: "Come as you are. Really." },
        body: "There is no dress code, no sign-up, and no one will ask you to stand up and introduce yourself.",
        facts: [
          {
            icon: "☕",
            title: "Coffee first",
            body: "The kettle is on from 9:30. Nobody starts on time anyway.",
          },
          {
            icon: "♥",
            title: "Kids stay in",
            body: "No separate programme — children are part of the room.",
          },
        ],
        form: {
          enabled: true,
          heading: "Say hello first",
          description: "Send a note and Dana will look out for you.",
          showPhone: false,
        },
      },
    },
    {
      type: "give_cta",
      props: {
        anchor: "give",
        eyebrow: "Giving",
        headline: { lead: "Keeping the door", accent: "open." },
        body: "Gifts here pay for the Tuesday meal, the heating bill, and not much else.",
        amounts: [15, 40, 75],
        bullets: ["Secure & encrypted"],
      },
    },
    { type: "footer_map", props: { anchor: "footer" } },
  ],
  /**
   * A hand edit that survives config regeneration. It patches the hero by TYPE
   * at church scope, which is the widest form -- it would apply to a hero on any
   * page of this site.
   */
  overrides: [
    {
      scope: "church",
      note: "Warmer hero surface than the classic theme default, per the pastor.",
      patch: {
        sections: {
          hero: { surface: "canvas-alt", align: "center" },
        },
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// SEEDING
// ---------------------------------------------------------------------------

const client = new Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});

async function resolveChurch(spec) {
  const existing = await client.query(
    "select id, name, email from public.churches where slug = $1",
    [spec.matchSlug],
  );

  if (existing.rowCount > 0) {
    const row = existing.rows[0];
    console.log(`  · bound to existing church "${row.name}" (profile untouched)`);
    return { id: row.id, email: row.email, created: false };
  }

  if (!spec.create) {
    // Louisville Grace must never be invented. If the row it expects is gone,
    // that is a real problem to look at, not something to paper over with a
    // duplicate congregation.
    throw new Error(
      `No church with slug "${spec.matchSlug}". This site binds to an existing ` +
        `church and will not create one. Check the slug and re-run.`,
    );
  }

  const p = spec.profile;
  const inserted = await client.query(
    `insert into public.churches
       (name, slug, denomination, tagline, description,
        mission_statement, vision_statement, address, city, state, zip, timezone)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     returning id`,
    [
      p.name,
      spec.matchSlug,
      p.denomination,
      p.tagline,
      p.description,
      p.mission_statement,
      p.vision_statement,
      p.address,
      p.city,
      p.state,
      p.zip,
      p.timezone,
    ],
  );

  const id = inserted.rows[0].id;
  console.log(`  · created demo church "${p.name}"`);

  for (const [i, time] of spec.serviceTimes.entries()) {
    await client.query(
      `insert into public.church_service_times
         (church_id, label, day_of_week, start_time, kind, sort_order)
       values ($1,$2,$3,$4,$5,$6)`,
      [id, time.label, time.day_of_week, time.start_time, time.kind, i],
    );
  }

  for (const [i, person] of spec.staff.entries()) {
    await client.query(
      `insert into public.church_staff
         (church_id, full_name, title, bio, is_public, sort_order)
       values ($1,$2,$3,$4,true,$5)`,
      [id, person.full_name, person.title, person.bio, i],
    );
  }

  console.log(
    `  · ${spec.serviceTimes.length} service times, ${spec.staff.length} staff`,
  );

  return { id, email: null, created: true };
}

/** Removes the fabricated demo church and everything cascading from it. */
async function cleanupDemo() {
  const found = await client.query(
    "select id, name from public.churches where slug = $1",
    [RIVERBEND.matchSlug],
  );

  if (found.rowCount === 0) {
    console.log(`Nothing to remove — no church with slug "${RIVERBEND.matchSlug}".`);
    return;
  }

  await client.query("delete from public.churches where slug = $1", [
    RIVERBEND.matchSlug,
  ]);
  console.log(`Removed demo church "${found.rows[0].name}" and all its rows.`);
}

async function seedSite(churchId, spec) {
  // is_published stays false: it only drives the noindex tag, and a client site
  // should be opted into search deliberately rather than by running a seed.
  // The page itself is status 'published' so it renders at its preview URL.
  await client.query(
    `insert into public.site_settings
       (church_id, theme_key, brand_tokens, contact_email, is_published)
     values ($1,$2,$3,$4,false)
     on conflict (church_id) do update set
       theme_key = excluded.theme_key,
       brand_tokens = excluded.brand_tokens,
       contact_email = excluded.contact_email,
       is_published = excluded.is_published`,
    [churchId, spec.themeKey, JSON.stringify(spec.brandTokens ?? {}), CONTACT_EMAIL],
  );

  await client.query(
    `insert into public.site_domains (church_id, hostname, is_primary, verified_at)
     values ($1,$2,true,now())
     on conflict (hostname) do update set church_id = excluded.church_id`,
    [churchId, spec.hostname.toLowerCase()],
  );

  const page = await client.query(
    `insert into public.site_pages
       (church_id, path, title, meta_description, status)
     values ($1,'/',$2,$3,'published')
     on conflict (church_id, path) do update set
       title = excluded.title,
       meta_description = excluded.meta_description,
       status = excluded.status
     returning id`,
    [churchId, spec.page.title, spec.page.meta_description],
  );
  const pageId = page.rows[0].id;

  // Overrides cascade-delete with their sections, so they are rewritten after.
  await client.query("delete from public.site_sections where page_id = $1", [pageId]);
  await client.query("delete from public.site_overrides where church_id = $1", [
    churchId,
  ]);

  for (const [i, section] of spec.sections.entries()) {
    await client.query(
      `insert into public.site_sections
         (page_id, church_id, type, sort_order, is_visible, props)
       values ($1,$2,$3,$4,$5,$6)`,
      [
        pageId,
        churchId,
        section.type,
        i * 10,
        section.is_visible !== false,
        JSON.stringify(section.props ?? {}),
      ],
    );
  }

  for (const override of spec.overrides ?? []) {
    await client.query(
      `insert into public.site_overrides (church_id, scope, patch, note)
       values ($1,$2,$3,$4)`,
      [churchId, override.scope, JSON.stringify(override.patch), override.note],
    );
  }

  await client.query("delete from public.site_media where church_id = $1", [churchId]);
  for (const [i, item] of spec.media.entries()) {
    await client.query(
      `insert into public.site_media
         (church_id, title, series, speaker, published_at, sort_order, is_published)
       values ($1,$2,$3,$4,$5,$6,true)`,
      [churchId, item.title, item.series, item.speaker, item.published_at, i],
    );
  }

  console.log(
    `  · ${spec.sections.length} sections, ${spec.overrides?.length ?? 0} overrides, ` +
      `${spec.media.length} media, theme "${spec.themeKey}"`,
  );
}

try {
  await client.connect();

  if (CLEANUP_DEMO) {
    await cleanupDemo();
    process.exit(0);
  }

  const themes = await client.query("select count(*)::int as n from public.site_themes");
  if (themes.rows[0].n === 0) {
    console.error("No site_themes rows. Run `pnpm db:church-sites` first.");
    process.exit(1);
  }

  const specs = SKIP_DEMO ? [GRACE] : [GRACE, RIVERBEND];
  const results = [];

  for (const spec of specs) {
    console.log(`\n${spec.matchSlug}:`);
    await client.query("begin");
    try {
      const church = await resolveChurch(spec);
      await seedSite(church.id, spec);
      await client.query("commit");
      results.push({ spec, church });
    } catch (err) {
      await client.query("rollback");
      throw err;
    }
  }

  console.log("\nDone. Preview at:");
  for (const { spec } of results) {
    console.log(`  /sites/${spec.matchSlug}`);
  }

  // Where contact submissions land is the one thing here that reaches a real
  // person, so it gets said out loud rather than left to be discovered.
  console.log("\nContact form delivery:");
  for (const { spec, church } of results) {
    const target = CONTACT_EMAIL ?? church.email;
    console.log(
      `  ${spec.matchSlug} → ${target ?? "(stored only — no recipient on file)"}`,
    );
  }
  if (!CONTACT_EMAIL) {
    console.log(
      "  Set SEED_CONTACT_EMAIL and re-run to route these somewhere you can check.",
    );
  }

  if (!SKIP_DEMO) {
    console.log(
      `\nRiverbend Chapel is a fabricated church for the multi-tenant proof.\n` +
        `  Remove it with: pnpm seed:demo-sites --cleanup-demo`,
    );
  }
} catch (err) {
  console.error("\nSeed failed:", err.message ?? err);
  process.exit(1);
} finally {
  await client.end();
}
