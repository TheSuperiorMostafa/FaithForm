"use client";

import { Plus } from "lucide-react";
import { createSupportTicket } from "@/app/admin/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import type { AdminChurchSummary } from "@/lib/queries/admin";

type SupportTicketDialogProps = {
  churches: AdminChurchSummary[];
  defaultChurchId?: string;
};

export function SupportTicketDialog({
  churches,
  defaultChurchId = "",
}: SupportTicketDialogProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button>
          <Plus className="size-4" strokeWidth={1.75} />
          New Ticket
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create support ticket</DialogTitle>
          <DialogDescription>
            Open a platform support item for a church.
          </DialogDescription>
        </DialogHeader>

        <form action={createSupportTicket} className="space-y-4 p-6">
          <div className="space-y-2">
            <Label htmlFor="churchId">Church</Label>
            <Select id="churchId" name="churchId" defaultValue={defaultChurchId}>
              <option value="">No church</option>
              {churches.map((church) => (
                <option key={church.id} value={church.id}>
                  {church.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="subject">Subject</Label>
            <Input id="subject" name="subject" required />
          </div>

          <div className="space-y-2">
            <Label htmlFor="body">Body</Label>
            <Textarea id="body" name="body" rows={5} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="priority">Priority</Label>
            <Select id="priority" name="priority" defaultValue="normal">
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </Select>
          </div>

          <DialogFooter className="-mx-6 -mb-6 mt-6">
            <Button type="submit">Create ticket</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
