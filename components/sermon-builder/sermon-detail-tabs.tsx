"use client";

import { CreateLessonPanel } from "@/components/sermon-builder/create-lesson-panel";
import { SermonEditor } from "@/components/sermon-builder/sermon-editor";
import { SermonSlides } from "@/components/sermon-builder/sermon-slides";
import { SocialSnippetsPanel } from "@/components/sermon-builder/social-snippets";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { SermonDetailTab } from "@/lib/sermon-builder/sermon-display";
import { LESSON_ANCHOR } from "@/lib/sermons/v1/share-rules";
import type {
  DiscussionQuestion,
  Sermon,
  SermonOutline,
  SocialSnippets,
} from "@/types/sermon";

/**
 * The sermon's three jobs, one tab each: Slides (preview, Present,
 * Download), Lesson (outline, questions, PDF) and Social posts. Sermons made
 * with the older full-manuscript builder get a Manuscript tab in place of
 * Lesson.
 */
export function SermonDetailTabs({
  sermon,
  questions,
  socialInitial,
  initialTab = "slides",
}: {
  sermon: Sermon;
  questions: DiscussionQuestion[];
  socialInitial?: SocialSnippets;
  initialTab?: SermonDetailTab;
}) {
  const isSimple = (sermon.kind ?? "advanced") === "simple";
  const tab: SermonDetailTab =
    initialTab === "lesson" && !isSimple
      ? "manuscript"
      : initialTab === "manuscript" && isSimple
        ? "lesson"
        : initialTab;

  return (
    <Tabs defaultValue={tab}>
      <TabsList aria-label="Parts of this sermon" className="flex w-full justify-start overflow-x-auto">
        <TabsTrigger value="slides">Slides</TabsTrigger>
        {isSimple ? (
          <TabsTrigger value="lesson">Lesson</TabsTrigger>
        ) : (
          <TabsTrigger value="manuscript">Manuscript</TabsTrigger>
        )}
        <TabsTrigger value="social">Social posts</TabsTrigger>
      </TabsList>

      <TabsContent value="slides" className="mt-6">
        <SermonSlides sermonId={sermon.id} version={sermon.updated_at} canEdit={isSimple} />
      </TabsContent>

      {isSimple ? (
        <TabsContent value="lesson" className="mt-6">
          <div id={LESSON_ANCHOR} className="scroll-mt-24">
            <CreateLessonPanel
              sermonId={sermon.id}
              sermonTitle={sermon.title}
              scriptureRefs={sermon.scripture_refs}
              outline={(sermon.outline as SermonOutline | null) ?? null}
              questions={questions}
            />
          </div>
        </TabsContent>
      ) : (
        <TabsContent value="manuscript" className="mt-6">
          <SermonEditor sermon={sermon} />
        </TabsContent>
      )}

      <TabsContent value="social" className="mt-6">
        <SocialSnippetsPanel sermonId={sermon.id} initial={socialInitial} />
      </TabsContent>
    </Tabs>
  );
}
