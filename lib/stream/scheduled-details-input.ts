export class ScheduledDetailsError extends Error {}

export function readScheduledDetails(form: FormData) {
  const title = form.get("title")?.toString().trim() ?? "";
  if (!title) throw new ScheduledDetailsError("Give the service a title first.");
  if (title.length > 120) throw new ScheduledDetailsError("Keep the title to 120 characters or fewer.");
  const seriesId = form.get("series_id")?.toString().trim() ?? "";
  const newSeriesName = form.get("new_series_name")?.toString().trim() ?? "";
  if (seriesId === "__new__" && (!newSeriesName || newSeriesName.length > 120)) {
    throw new ScheduledDetailsError("Give the new series a name of 120 characters or fewer.");
  }
  if (seriesId && seriesId !== "__new__" && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seriesId)) {
    throw new ScheduledDetailsError("Choose a series from the list.");
  }
  const readJsonTags = (key: string, label: string, maxLength: number): string[] | undefined => {
    if (!form.has(`${key}_json`)) return undefined;
    let parsed: unknown;
    try { parsed = JSON.parse(String(form.get(`${key}_json`))); }
    catch { throw new ScheduledDetailsError(`Check the ${label} and try again.`); }
    if (!Array.isArray(parsed) || parsed.some(value => typeof value !== "string")) {
      throw new ScheduledDetailsError(`Check the ${label} and try again.`);
    }
    const values = [...new Set((parsed as string[]).map(value => value.trim()).filter(Boolean))];
    if (values.length > 20 || values.some(value => value.length > maxLength)) {
      throw new ScheduledDetailsError(`Use up to 20 ${label}, each ${maxLength} characters or fewer.`);
    }
    return values;
  };
  const speakers = readJsonTags("speakers", "speaker names", 120);
  const speaker = speakers !== undefined ? speakers[0] ?? "" : form.get("speaker")?.toString().trim() ?? "";
  const description = form.get("description")?.toString().trim() ?? "";
  if (speaker.length > 120) throw new ScheduledDetailsError("Keep the speaker name to 120 characters or fewer.");
  if (description.length > 2000) throw new ScheduledDetailsError("Keep the description to 2,000 characters or fewer.");
  const tags = (key: string, label: string) => {
    const values = [...new Set((form.get(key)?.toString() ?? "").split(",").map(value => value.trim()).filter(Boolean))];
    if (values.length > 20 || values.some(value => value.length > 80)) {
      throw new ScheduledDetailsError(`Use up to 20 ${label}, each 80 characters or fewer.`);
    }
    return values;
  };
  const appVisibility = form.get("app_visibility")?.toString();
  if (appVisibility !== undefined && !["none", "public", "followers", "members"].includes(appVisibility)) {
    throw new ScheduledDetailsError("Choose who can watch this service in the app.");
  }
  const publication = appVisibility === undefined ? {} : {
    recordingAppVisibility: appVisibility as "none" | "public" | "followers" | "members",
    recordingPublishToWebsite: form.get("publish_to_website") === "on",
    publicAccess: form.get("publish_to_website") === "on",
    recordingNotifyMembers: form.get("notify_members") === "on",
  };
  return { ...publication, title, seriesId: seriesId || null, newSeriesName,
    speaker: speaker || null, description: description || null,
    ...(speakers !== undefined ? { speakers } : {}),
    chapters: readJsonTags("chapters", "Scripture references", 80) ?? tags("chapters", "Scripture references"),
    topics: readJsonTags("topics", "topics", 80) ?? tags("topics", "topics"),
  };
}

