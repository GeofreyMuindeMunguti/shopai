import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const QUICK_REASONS = ['Too expensive', 'Wrong colour', 'Wrong size', 'Not the right product', "Don't trust this store"];

interface RejectReasonDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productTitle: string;
  onConfirm: (reason: string | null) => void;
}

/** Optional rejection reason; it's fed into the next search as a negative constraint (FR-12). */
export function RejectReasonDialog({ open, onOpenChange, productTitle, onConfirm }: RejectReasonDialogProps) {
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reject this match?</DialogTitle>
          <DialogDescription className="line-clamp-2">{productTitle}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2" role="group" aria-label="Common reasons">
            {QUICK_REASONS.map((r) => (
              <Button key={r} type="button" size="sm" variant={reason === r ? 'default' : 'outline'} onClick={() => setReason(r)}>
                {r}
              </Button>
            ))}
          </div>
          <div className="space-y-2">
            <Label htmlFor="reject-reason">Reason (optional)</Label>
            <Textarea
              id="reject-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Helps the next search avoid similar results"
              maxLength={300}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={() => onConfirm(reason.trim() || null)}>
            Reject
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
