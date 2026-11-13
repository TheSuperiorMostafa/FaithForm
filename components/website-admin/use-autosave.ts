"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AutosaveQueue, type AutosaveStatus, type SaveResult } from "./autosave-queue";
import { draftRecoveryVersion, DraftRecoveryStore, type RecoveredDraft } from "./draft-recovery";
import { guardWebsiteNavigation, hasUnsavedWebsiteEdits, registerWebsiteEditor } from "./editor-save-guard";

export type { AutosaveStatus, SaveResult } from "./autosave-queue";

/** Serialize writes and keep unsaved revisions available after browser history. */
export function useAutosave<T>(
  value: T,
  save: (value: T) => Promise<SaveResult>,
  options: {
    delay?: number;
    enabled?: boolean;
    recoveryKey?: string;
    validateRecovery?: (value: unknown) => value is T;
    autosaveRecovered?: (value: T) => boolean;
    backupWhenDisabled?: (value: T) => boolean;
  } = {},
): {
  status: AutosaveStatus;
  saveNow: () => Promise<SaveResult>;
  adoptSaved: (value: T) => void;
  hasUnsavedChanges: () => boolean;
  recovery: RecoveredDraft<T> | null;
  recoveryWarning: string | null;
  restoreRecovered: () => T | null;
  discardRecovered: () => void;
  backupDraft: (update: (current: T) => T) => void;
} {
  const { delay = 900, enabled = true, recoveryKey } = options;
  const [status, setStatus] = useState<AutosaveStatus>({ kind: "idle" });
  const [recovery, setRecovery] = useState<RecoveredDraft<T> | null>(null);
  const [recoveryWarning, setRecoveryWarning] = useState<string | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const backupRef = useRef<DraftRecoveryStore<T> | null>(null);
  const recoveryStores = useRef(new Map<string, DraftRecoveryStore<T>>());
  const queueRef = useRef<AutosaveQueue<T> | null>(null);
  if (!queueRef.current) {
    queueRef.current = new AutosaveQueue((next) => saveRef.current(next), setStatus, undefined, {
      capture: next => backupRef.current?.capture(next) ?? (() => {}),
      clear: () => backupRef.current?.clear(),
    });
  }
  const queue = queueRef.current;
  const lastSeen = useRef(value);
  const wasEnabled = useRef(enabled);
  const saveNow = useCallback(() => queue.flush(), [queue]);
  const adoptSaved = useCallback((next: T) => {
    lastSeen.current = next;
    queue.adoptSaved();
    setRecovery(null);
  }, [queue]);
  const backupVersion = recoveryKey ? draftRecoveryVersion(recoveryKey) : 0;
  const backupDraft = useCallback((update: (current: T) => T) => {
    // A completed upload may outlive the editor. Merge only into its captured
    // account/church backup, and never resurrect a discarded/reset draft.
    if (!recoveryKey || draftRecoveryVersion(recoveryKey) !== backupVersion) return;
    const store = recoveryStores.current.get(recoveryKey);
    const validate = optionsRef.current.validateRecovery;
    const current = (validate && store?.read(validate)?.value) ?? lastSeen.current;
    const next = update(current);
    if (JSON.stringify(next) !== JSON.stringify(current)) store?.capture(next);
  }, [recoveryKey, backupVersion]);
  const discardRecovered = useCallback(() => {
    backupRef.current?.clear();
    setRecovery(null);
  }, []);
  const restoreRecovered = useCallback(() => {
    if (!recovery) return null;
    const restored = recovery.value;
    lastSeen.current = restored;
    setRecovery(null);
    if (optionsRef.current.autosaveRecovered?.(restored) ?? optionsRef.current.enabled ?? true) {
      queue.enqueue(restored, delay);
    }
    return restored;
  }, [recovery, queue, delay]);

  useEffect(() => {
    if (!recoveryKey) return;
    let storage: Storage | null = null;
    try { storage = window.sessionStorage; } catch { /* Report unavailable below. */ }
    const store = new DraftRecoveryStore<T>(storage, recoveryKey, () => {
      setRecoveryWarning("This browser cannot keep a backup of unsaved changes. Wait for Saved before leaving, and keep this page open if a save fails.");
    });
    backupRef.current = store;
    recoveryStores.current.set(recoveryKey, store);
    const validate = optionsRef.current.validateRecovery;
    if (validate) setRecovery(store.read(validate));
    const unsubscribe = store.subscribeToRemoval(() => setRecovery(null));
    return () => {
      unsubscribe();
      backupRef.current = null;
    };
  }, [recoveryKey]);

  useEffect(() => {
    if (!enabled) {
      if (wasEnabled.current) void queue.flush();
      wasEnabled.current = false;
      if (!Object.is(value, lastSeen.current) && optionsRef.current.backupWhenDisabled?.(value)) {
        backupRef.current?.capture(value);
      }
      lastSeen.current = value;
      return;
    }
    if (!wasEnabled.current) {
      wasEnabled.current = true;
      lastSeen.current = value;
      return;
    }
    if (Object.is(value, lastSeen.current)) return;
    lastSeen.current = value;
    queue.enqueue(value, delay);
  }, [value, delay, enabled, queue]);

  useEffect(() => {
    queue.resume();
    const unregister = registerWebsiteEditor(queue);
    const guardClick = (event: MouseEvent) => guardWebsiteNavigation(event);
    document.addEventListener("click", guardClick, true);
    const retryOnline = () => {
      if (queue.hasUnsavedChanges) void queue.flush();
    };
    const warn = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedWebsiteEdits()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("online", retryOnline);
    window.addEventListener("beforeunload", warn);
    return () => {
      unregister();
      document.removeEventListener("click", guardClick, true);
      window.removeEventListener("online", retryOnline);
      window.removeEventListener("beforeunload", warn);
      queue.stop();
    };
  }, [queue]);

  return { status, saveNow, adoptSaved, hasUnsavedChanges: () => queue.hasUnsavedChanges, recovery, recoveryWarning, restoreRecovered, discardRecovered, backupDraft };
}
