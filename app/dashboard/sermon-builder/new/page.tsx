import { redirect } from "next/navigation";
import { SimpleSermonBuilder } from "@/components/sermon-builder/simple-sermon-builder";
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

  // One flow for everyone: build the deck, then "Create lesson" on the deck
  // page adds the outline and discussion questions.
  const translationOptions = await getCuratedTranslations();
  const defaultTranslation = await getDefaultTranslationId(
    settings?.default_translation,
  );

  return (
    <div className="flex flex-col gap-4">
      <h1 className="border-l-4 border-accent pl-3 font-heading text-[26px] font-bold">
        New sermon
      </h1>
      <SimpleSermonBuilder
        translationOptions={translationOptions}
        defaultTranslation={defaultTranslation}
        initial={{
          title: searchParams.topic,
        }}
      />
    </div>
  );
}
