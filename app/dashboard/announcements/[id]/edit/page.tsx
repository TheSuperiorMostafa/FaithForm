import { redirect } from "next/navigation";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditAnnouncementPage({ params }: PageProps) {
  const { id } = await params;
  redirect(`/dashboard/announcements?published=${id}`);
}
