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
  return { title, seriesId: seriesId || null, newSeriesName };
}
