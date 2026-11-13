"use client";

import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { RecordingTagsField, type RecordingTagsValue } from "@/components/media/recording-tags-field";

function Field({ id, label, optional, children }: { id: string; label: string; optional?: boolean; children: ReactNode }) {
  return <div className="flex flex-col gap-2">
    <Label htmlFor={id} className="text-[15px]">{label}{optional ? <span className="ml-1 font-normal text-muted-foreground">(optional)</span> : null}</Label>
    {children}
  </div>;
}

/** Shared by recording review and the upcoming service editor. */
export function RecordingPrimaryFields({ title, onTitleChange, seriesId, onSeriesChange, newSeries, onNewSeriesChange, series, idPrefix = "rec", titleMaxLength = 200 }: {
  title: string; onTitleChange: (value: string) => void;
  seriesId: string; onSeriesChange: (value: string) => void;
  newSeries: string; onNewSeriesChange: (value: string) => void;
  series: { id: string; name: string }[]; idPrefix?: string; titleMaxLength?: number;
}) {
  return <>
    <Field id={`${idPrefix}-title`} label="Title">
      <Input id={`${idPrefix}-title`} name="title" value={title} onChange={event => onTitleChange(event.target.value)} required maxLength={titleMaxLength} />
    </Field>
    <Field id={`${idPrefix}-series`} label="Series" optional>
      <Select id={`${idPrefix}-series`} name="series_id" value={seriesId} onChange={event => onSeriesChange(event.target.value)}>
        <option value="">No series</option>
        {series.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
        <option value="__new__">New series…</option>
      </Select>
      {seriesId === "__new__" ? <Input className="mt-2" name="new_series_name" value={newSeries} onChange={event => onNewSeriesChange(event.target.value)} placeholder="Series name" aria-label="New series name" required maxLength={120} /> : null}
    </Field>
  </>;
}

export function RecordingExtraFields({ speakers, onSpeakersChange, description, onDescriptionChange, chapters, onChaptersChange, topics, onTopicsChange, idPrefix = "rec" }: {
  speakers: RecordingTagsValue; onSpeakersChange: (value: RecordingTagsValue) => void;
  description: string; onDescriptionChange: (value: string) => void;
  chapters: RecordingTagsValue; onChaptersChange: (value: RecordingTagsValue) => void;
  topics: RecordingTagsValue; onTopicsChange: (value: RecordingTagsValue) => void; idPrefix?: string;
}) {
  return <>
    <Field id={`${idPrefix}-speaker`} label="Speakers" optional><RecordingTagsField id={`${idPrefix}-speaker`} name="speakers" label="Speakers" addLabel="Add speaker" value={speakers} onChange={onSpeakersChange} placeholder="Speaker name" maxLength={120} /></Field>
    <Field id={`${idPrefix}-description`} label="Description" optional><Textarea id={`${idPrefix}-description`} name="description" value={description} onChange={event => onDescriptionChange(event.target.value)} placeholder="What was this service about?" className="min-h-28 resize-y" rows={3} maxLength={2000} /></Field>
    <Field id={`${idPrefix}-chapters`} label="Scripture" optional><RecordingTagsField id={`${idPrefix}-chapters`} name="chapters" label="Scripture" addLabel="Add Scripture" value={chapters} onChange={onChaptersChange} placeholder="Scripture reference" /></Field>
    <Field id={`${idPrefix}-topics`} label="Topics" optional><RecordingTagsField id={`${idPrefix}-topics`} name="topics" label="Topics" addLabel="Add topic" value={topics} onChange={onTopicsChange} placeholder="Topic" /></Field>
  </>;
}
