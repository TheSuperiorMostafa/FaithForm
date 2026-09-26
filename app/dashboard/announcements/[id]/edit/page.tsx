import { redirect } from "next/navigation";
import { pageFeatureBlocked } from "@/lib/features/page-gate";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditAnnouncementPage({ params }: PageProps) {
  if (await pageFeatureBlocked("announcements")) return null;

  const { id } = await params;
  redirect(`/dashboard/announcements?published=${id}`);
}
