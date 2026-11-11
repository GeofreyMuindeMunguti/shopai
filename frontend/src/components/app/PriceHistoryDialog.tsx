import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { usePriceHistory } from '@/data/queries';
import type { ProductMatch } from '@/data/types';
import { AVAILABILITY_LABEL, formatDateTime, formatMoney } from '@/lib/format';

interface PriceHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  match: ProductMatch;
}

/** Verified price observations for one match (time_series_points via match_price_history). */
export function PriceHistoryDialog({ open, onOpenChange, match }: PriceHistoryDialogProps) {
  const history = usePriceHistory(match.id, open);
  const rows = [...(history.data ?? [])].reverse();
  const prices = rows.map((r) => Number(r.price));
  const low = prices.length ? Math.min(...prices) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Price history</DialogTitle>
          <DialogDescription className="line-clamp-2">
            {match.title} · {match.store_domain}
          </DialogDescription>
        </DialogHeader>
        {history.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">No verified prices recorded yet.</p>
        ) : (
          <div className="max-h-80 overflow-y-auto">
            {low !== null && (
              <p className="mb-2 text-sm">
                Lowest seen: <span className="font-semibold">{formatMoney(low, rows[0].currency)}</span> across {rows.length} checks
              </p>
            )}
            <Table>
              <caption className="sr-only">Price observations, newest first</caption>
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Checked</TableHead>
                  <TableHead scope="col" className="text-right">Price</TableHead>
                  <TableHead scope="col">Availability</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.observed_at}>
                    <TableCell>{formatDateTime(r.observed_at)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(r.price, r.currency)}</TableCell>
                    <TableCell>{AVAILABILITY_LABEL[r.availability ?? 'unknown'] ?? r.availability}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
