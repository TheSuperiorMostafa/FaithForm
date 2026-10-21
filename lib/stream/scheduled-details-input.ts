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
  const speaker = form.get("speaker")?.toString().trim() ?? "";
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
  return { title, seriesId: seriesId || null, newSeriesName,
    speaker: speaker || null, description: description || null,
    chapters: tags("chapters", "Scripture references"), topics: tags("topics", "topics"),
  };
}
