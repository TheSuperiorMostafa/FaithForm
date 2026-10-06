import QRCode from "qrcode";
import { notFound } from "next/navigation";

export const metadata = { title: "Join your church | FaithForm", robots: { index: false, follow: false } };

export default async function ChurchInvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{16,512}$/.test(token)) notFound();
  const qr = await QRCode.toDataURL(`https://faithform.io/faithform/invite/${token}`, { width: 256, margin: 2 });
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background p-6 text-foreground">
      <div className="w-full max-w-md space-y-5 rounded-2xl border bg-card p-8 text-center">
        <h1 className="text-2xl font-semibold">You’re invited to your church</h1>
        <p className="text-muted-foreground">Open FaithForm to review your invitation and join. If you’re new, sign in or create an account first.</p>
        <a className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-4 font-medium text-primary-foreground" href={`faithform://invite/${token}`}>Open FaithForm</a>
        {/* A data image contains only this invitation, never a remotely loaded tracker. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr} width={256} height={256} alt="Scan this church invitation with FaithForm" className="mx-auto rounded-lg" />
        <p className="text-sm text-muted-foreground">On another device, scan this code from FaithForm’s invitation screen.</p>
      </div>
    </main>
  );
}
