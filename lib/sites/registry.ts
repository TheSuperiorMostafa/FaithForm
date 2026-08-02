import { aboutTextSection } from "@/components/sites/sections/about-text";
import { customEmbedSection } from "@/components/sites/sections/custom-embed";
import { eventsListSection } from "@/components/sites/sections/events-list";
import { footerMapSection } from "@/components/sites/sections/footer-map";
import { giveCtaSection } from "@/components/sites/sections/give-cta";
import { heroSection } from "@/components/sites/sections/hero";
import { programsGridSection } from "@/components/sites/sections/programs-grid";
import { sermonFeedSection } from "@/components/sites/sections/sermon-feed";
import { serviceTimesSection } from "@/components/sites/sections/service-times";
import { siteNavSection } from "@/components/sites/sections/site-nav";
import { staffGridSection } from "@/components/sites/sections/staff-grid";
import { visionMissionSection } from "@/components/sites/sections/vision-mission";
import { visitCtaSection } from "@/components/sites/sections/visit-cta";
import type { ErasedSectionMaster } from "@/lib/sites/contract";

/**
 * Every section type the renderer can draw.
 *
 * Adding a church is inserting rows. Adding a *capability* is adding a master
 * here -- which is the only time this product should need new code.
 */
const MASTERS: ErasedSectionMaster[] = [
  siteNavSection,
  heroSection,
  serviceTimesSection,
  aboutTextSection,
  visionMissionSection,
  staffGridSection,
  programsGridSection,
  eventsListSection,
  visitCtaSection,
  sermonFeedSection,
  giveCtaSection,
  footerMapSection,
  customEmbedSection,
];

export const SECTION_REGISTRY: Record<string, ErasedSectionMaster> =
  Object.fromEntries(MASTERS.map((master) => [master.type, master]));

export const SECTION_TYPES = MASTERS.map((master) => master.type);

export function isKnownSectionType(type: string): boolean {
  return type in SECTION_REGISTRY;
}
