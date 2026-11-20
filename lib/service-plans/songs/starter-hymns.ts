/**
 * Classic hymns a new library can start with. Only texts and tunes in the
 * public domain (written and published long before 1929), so a church can
 * print and project them without a licence. Lyrics are left for the church to
 * add from its own hymnal, since wording differs between hymnals.
 */
export type StarterHymn = {
  title: string;
  author: string;
  key: string;
  lengthSeconds: number;
  sectionOrder: string[];
};

const verses = (n: number) => Array.from({ length: n }, (_, i) => `Verse ${i + 1}`);
const withRefrain = (n: number) => verses(n).flatMap((v) => [v, "Refrain"]);

export const STARTER_HYMNS: readonly StarterHymn[] = [
  { title: "Amazing Grace", author: "John Newton", key: "G", lengthSeconds: 240, sectionOrder: verses(4) },
  {
    title: "Holy, Holy, Holy! Lord God Almighty",
    author: "Reginald Heber, John B. Dykes",
    key: "D",
    lengthSeconds: 240,
    sectionOrder: verses(4),
  },
  {
    title: "It Is Well with My Soul",
    author: "Horatio G. Spafford, Philip P. Bliss",
    key: "C",
    lengthSeconds: 300,
    sectionOrder: withRefrain(4),
  },
  {
    title: "Be Thou My Vision",
    author: "Irish hymn, tr. Mary E. Byrne, versified by Eleanor H. Hull",
    key: "D",
    lengthSeconds: 240,
    sectionOrder: verses(4),
  },
  {
    title: "Come, Thou Fount of Every Blessing",
    author: "Robert Robinson, John Wyeth",
    key: "D",
    lengthSeconds: 210,
    sectionOrder: verses(3),
  },
  {
    title: "Crown Him with Many Crowns",
    author: "Matthew Bridges, Godfrey Thring, George J. Elvey",
    key: "D",
    lengthSeconds: 240,
    sectionOrder: verses(4),
  },
  {
    title: "Blessed Assurance",
    author: "Fanny J. Crosby, Phoebe P. Knapp",
    key: "D",
    lengthSeconds: 240,
    sectionOrder: withRefrain(3),
  },
  {
    title: "A Mighty Fortress Is Our God",
    author: "Martin Luther, tr. Frederick H. Hedge",
    key: "C",
    lengthSeconds: 240,
    sectionOrder: verses(4),
  },
];
