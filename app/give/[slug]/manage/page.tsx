import { redirect } from "next/navigation";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function ManageRecurringPage({ params }: PageProps) {
  const { slug } = await params;
  redirect(`/give/${encodeURIComponent(slug)}/portal`);
}
