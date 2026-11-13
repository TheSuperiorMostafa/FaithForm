import { toast } from "sonner";
import type { SaveResult } from "./autosave-queue";

export type Editor = { readonly hasUnsavedChanges: boolean; flush: () => Promise<SaveResult> };
const editors = new Set<Editor>();

export function hasUnsavedWebsiteEdits(): boolean {
  return [...editors].some(editor => editor.hasUnsavedChanges);
}

export async function flushWebsiteEdits(except?: Editor): Promise<boolean> {
  // Completing a photo upload can enqueue a parent form save. Drain that next
  // pass as well before allowing the editor to unmount.
  while (true) {
    const dirty = [...editors].filter(editor => editor !== except && editor.hasUnsavedChanges);
    if (dirty.length === 0) return true;
    const results = await Promise.all(dirty.map(editor => editor.flush()));
    if (results.some(result => !result.ok)) return false;
  }
}

/** All visible editors must save before leaving, including Details and Look. */
export function registerWebsiteEditor(editor: Editor): () => void {
  editors.add(editor);
  return () => { editors.delete(editor); };
}

export function guardWebsiteNavigation(event: MouseEvent) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (!(event.target instanceof Element)) return;
  const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
  if (!anchor || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self")) return;
  const destination = new URL(anchor.href, window.location.href);
  if (!["http:", "https:"].includes(destination.protocol)) return;
  if (destination.origin === location.origin && destination.pathname === location.pathname && destination.search === location.search) return;
  if (![...editors].some(editor => editor.hasUnsavedChanges)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  void flushWebsiteEdits().then(saved => {
    if (saved) window.location.assign(destination.href);
    else toast.error("Your changes have not saved. Keep this page open and try saving again.");
  });
}
