/**
 * Names as FaithForm compares them.
 *
 * Mirrors `tidy_person_name` and `person_name_key` in migration 0083 so the
 * database and the dashboard agree on what "the same name" means: case does
 * not matter, runs of spaces do not matter, and neither does where the name
 * was split between the first- and last-name columns — "Mary" + "Ann Smith"
 * and "Mary Ann" + "Smith" are one name.
 */

export function tidyPersonName(value: string | null | undefined): string | null {
  const tidy = (value ?? "").trim().replace(/\s+/g, " ");
  return tidy ? tidy : null;
}

export function personNameKey(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
): string | null {
  return tidyPersonName(`${firstName ?? ""} ${lastName ?? ""}`)?.toLowerCase() ?? null;
}

/** The last word is the last name, as `split_person_name` does it. */
export function splitPersonName(value: string | null | undefined): {
  firstName: string;
  lastName: string;
} {
  const tidy = tidyPersonName(value);
  if (!tidy) return { firstName: "", lastName: "" };
  const at = tidy.lastIndexOf(" ");
  if (at === -1) return { firstName: tidy, lastName: "" };
  return { firstName: tidy.slice(0, at), lastName: tidy.slice(at + 1) };
}

/** Escapes a value for use inside a LIKE pattern. */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}
