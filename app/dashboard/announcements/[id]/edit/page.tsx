import { redirect } from "next/navigation";

type PageProps = {
  params: { id: string };
};

export default function EditAnnouncementPage({ params }: PageProps) {
  redirect(`/dashboard/announcements?published=${params.id}`);
}
