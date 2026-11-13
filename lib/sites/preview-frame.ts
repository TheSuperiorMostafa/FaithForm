/** The iframe's CSS viewport stays fixed; only its painted size changes. */
export function previewFrameGeometry(availableWidth: number, availableHeight: number, viewportWidth: number) {
  const scale = availableWidth > 0 ? Math.min(1, availableWidth / viewportWidth) : 1;
  return {scale, width:viewportWidth, height:Math.max(1,availableHeight)/scale, marginLeft:-(viewportWidth*scale)/2};
}

export function previewLoadMessage(input: { readable: boolean; hasWebsite: boolean; pathname?: string }): string | null {
  if (!input.readable) return "This link opened outside your website. Open it in a new tab, or refresh to return to your preview.";
  if (input.hasWebsite) return null;
  if (input.pathname?.startsWith("/login")) return "Sign in again, then refresh this preview. Your saved website is still safe.";
  return "Your website preview could not be loaded. Refresh this page and try again. If it still will not open, contact FaithForm support.";
}

/** The frame can leave its page only after the matching editor has saved. */
export async function navigateSitePreview(path: string, beforeNavigate: (path:string)=>boolean|void|Promise<boolean|void>, commit: ()=>void, isCurrent: ()=>boolean) {
  if (await beforeNavigate(path) === false || !isCurrent()) return false;
  commit();
  return true;
}
