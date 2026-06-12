import Link from "next/link";
import { redirect } from "next/navigation";
import { SimpleSermonBuilder } from "@/components/sermon-builder/simple-sermon-builder";
import { SermonWizard } from "@/components/sermon-builder/sermon-wizard";
import {
  getCuratedTranslations,
  getDefaultTranslationId,
} from "@/lib/bible/translations";
import { createClient } from "@/lib/supabase/server";
import { getCurrentChurchId } from "@/lib/queries/dashboard";
import { getChurchAISettings } from "@/lib/queries/sermons";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: {
    series?: string;
    topic?: string;
    scripture?: string;
  };
};

export default async function NewSermonPage({ searchParams }: Props) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const churchId = await getCurrentChurchId(supabase, user.id);
  if (!churchId) redirect("/dashboard");

  const settings = await getChurchAISettings(churchId);
  const mode = settings?.sermon_builder_mode ?? "simple";

  if (mode === "simple") {
    const translationOptions = getCuratedTranslations();
    const defaultTranslation = getDefaultTranslationId(
      settings?.default_translation,
    );
    return (
      <div className="flex flex-col gap-4">
        <h1 className="border-l-4 border-accent pl-3 font-heading text-[26px] font-bold">
          New slide deck
        </h1>
        <SimpleSermonBuilder
          translationOptions={translationOptions}
          defaultTranslation={defaultTranslation}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="border-l-4 border-accent pl-3 font-heading text-[26px] font-bold">
        New sermon
      </h1>
      <p className="text-sm text-muted-foreground">
        Using <strong>Advanced</strong> mode —{" "}
        <Link
          href="/dashboard/settings"
          className="text-primary underline-offset-4 hover:text-accent hover:underline"
        >
          switch to Simple in Settings
        </Link>
      </p>
      <SermonWizard
        seriesId={searchParams.series}
        initialTopic={searchParams.topic ?? ""}
        initialScripture={searchParams.scripture ?? ""}
      />
    </div>
  );
}
