import { ManageRecurringForm } from "@/app/give/[slug]/manage/manage-form";

type PageProps = {
  params: { slug: string };
};

export default function ManageRecurringPage({ params }: PageProps) {
  return <ManageRecurringForm slug={params.slug} />;
}
