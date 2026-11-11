import { useMemo, useState } from 'react';
import { Archive, ArchiveRestore, ChevronRight, Loader2, Pencil, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { ITEM_STATUS_LABEL, formatMoney, timeAgo } from '@/lib/format';
import type { FxTable } from '@/lib/fx';
import { VISIBLE_STATUSES, rankMatches } from '@/lib/ranking';
import type { Decision, ProductMatch, ScoutRun, WishlistItem } from '@/data/types';
import { CandidateCard } from './CandidateCard';
import { RetailerFilterChips, ALL_RETAILERS } from './RetailerFilterChips';
import { RetailerProgress } from './RetailerProgress';

interface ItemPanelProps {
  item: WishlistItem;
  matches: ProductMatch[];
  /** Runs for this item, newest first. */
  runs: ScoutRun[];
  retailerNames: Record<string, string>;
  displayCurrency: string;
  fx: FxTable | undefined;
  defaultOpen?: boolean;
  busy?: boolean;
  onDecide: (match: ProductMatch, decision: Decision, reason?: string | null) => void;
  onFindMore: () => void;
  onEdit: () => void;
  onArchiveToggle: () => void;
}

const SHOWN_LIMIT = 6;

export function ItemPanel({ item, matches, runs, retailerNames, displayCurrency, fx, defaultOpen, busy, onDecide, onFindMore, onEdit, onArchiveToggle }: ItemPanelProps) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  const [retailerFilter, setRetailerFilter] = useState(ALL_RETAILERS);
  const [groupByRetailer, setGroupByRetailer] = useState(false);
  const [showUnverified, setShowUnverified] = useState(false);
  const [showRejected, setShowRejected] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const latestRun = runs[0];
  const active = latestRun ? latestRun.status === 'queued' || latestRun.status === 'running' : false;
  const lastFinished = runs.find((r) => r.status !== 'queued' && r.status !== 'running');
  const runCreated = useMemo(() => new Map(runs.map((r) => [r.id, r.created_at])), [runs]);
  const lastEdit = runs.find((r) => r.trigger === 'constraints_changed');

  const visible = matches.filter(
    (m) =>
      !m.duplicate_of &&
      (VISIBLE_STATUSES.includes(m.status) || (showUnverified && m.status === 'unverified') || (showRejected && m.status === 'rejected'))
  );
  const goodCount = matches.filter((m) => !m.duplicate_of && (m.status === 'proposed' || m.status === 'approved' || m.status === 'saved')).length;
  const unverifiedCount = matches.filter((m) => m.status === 'unverified').length;
  const rejectedCount = matches.filter((m) => m.status === 'rejected').length;
  const foundSoFar = latestRun ? matches.filter((m) => m.scout_run_id === latestRun.id && m.status !== 'unverified').length : 0;

  const counts = visible.reduce<Record<string, number>>((acc, m) => ({ ...acc, [m.retailer_code]: (acc[m.retailer_code] ?? 0) + 1 }), {});
  const filtered = retailerFilter === ALL_RETAILERS ? visible : visible.filter((m) => m.retailer_code === retailerFilter);
  const { shown, hiddenCount } = rankMatches(filtered, { currency: displayCurrency, fx: fx ?? { rates: { USD: 1 }, asOf: {} }, limit: showAll ? undefined : SHOWN_LIMIT });

  const isNew = (m: ProductMatch) => Boolean(lastFinished && lastFinished.trigger === 'scheduled' && m.first_seen_run_id === lastFinished.id);
  const isOutdated = (m: ProductMatch) => {
    if (!lastEdit || !m.scout_run_id) return false;
    const created = runCreated.get(m.scout_run_id);
    return Boolean(created && created < lastEdit.created_at);
  };

  const card = (m: ProductMatch) => (
    <li key={m.id}>
      <CandidateCard
        match={m}
        retailerName={retailerNames[m.retailer_code] ?? m.retailer_code}
        displayCurrency={displayCurrency}
        fx={fx}
        isNew={isNew(m)}
        isOutdated={isOutdated(m)}
        busy={busy}
        onDecide={(d, reason) => onDecide(m, d, reason)}
      />
    </li>
  );

  const grid = 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3';
  const archived = item.status === 'archived';
  const statusLabel = active && item.status !== 'approved' ? 'Scouting…' : ITEM_STATUS_LABEL[item.status];
  const failed = latestRun?.status === 'failed';

  return (
    <Card className={cn(archived && 'opacity-70')}>
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className="flex flex-wrap items-center gap-3 p-4">
          <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md">
            <ChevronRight className={cn('h-4 w-4 shrink-0 transition-transform', open && 'rotate-90')} aria-hidden />
            <h3 className="truncate font-semibold">{item.title}</h3>
            {item.max_price != null && <span className="shrink-0 text-sm text-muted-foreground">≤ {formatMoney(item.max_price, item.currency)}</span>}
          </CollapsibleTrigger>
          <div className="flex items-center gap-2" aria-live="polite">
            {active && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />}
            <Badge variant={item.status === 'approved' ? 'default' : 'secondary'}>{statusLabel}</Badge>
            {active ? (
              <span className="text-sm text-muted-foreground">{foundSoFar} found so far…</span>
            ) : (
              goodCount > 0 && <span className="text-sm text-muted-foreground">● {goodCount} {goodCount === 1 ? 'match' : 'matches'}</span>
            )}
          </div>
        </div>

        <CollapsibleContent>
          <div className="space-y-4 border-t p-4">
            {latestRun && (
              <div className="space-y-1">
                <RetailerProgress
                  retailerCodes={latestRun.retailer_codes}
                  results={latestRun.retailer_results ?? {}}
                  retailerNames={retailerNames}
                  active={active}
                />
                <p className="text-xs text-muted-foreground">
                  {active ? 'Searching now' : `Last searched ${timeAgo(latestRun.finished_at ?? latestRun.created_at)}`}
                  {latestRun.model_fallback_reason ? ` · ${latestRun.model_fallback_reason}` : ''}
                </p>
              </div>
            )}

            {failed && !active && (
              <Alert variant="destructive">
                <AlertTitle>The last search didn't finish</AlertTitle>
                <AlertDescription>{latestRun?.error ?? 'Search is temporarily unavailable, we\'ll retry automatically.'}</AlertDescription>
              </Alert>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <RetailerFilterChips counts={counts} retailerNames={retailerNames} value={retailerFilter} onChange={setRetailerFilter} />
              <div className="flex flex-wrap items-center gap-4 text-sm">
                {Object.keys(counts).length > 1 && (
                  <div className="flex items-center gap-2">
                    <Switch id={`group-${item.id}`} checked={groupByRetailer} onCheckedChange={setGroupByRetailer} />
                    <Label htmlFor={`group-${item.id}`} className="font-normal">Group by retailer</Label>
                  </div>
                )}
                {unverifiedCount > 0 && (
                  <div className="flex items-center gap-2">
                    <Switch id={`unverified-${item.id}`} checked={showUnverified} onCheckedChange={setShowUnverified} />
                    <Label htmlFor={`unverified-${item.id}`} className="font-normal">Show {unverifiedCount} unverified</Label>
                  </div>
                )}
                {rejectedCount > 0 && (
                  <div className="flex items-center gap-2">
                    <Switch id={`rejected-${item.id}`} checked={showRejected} onCheckedChange={setShowRejected} />
                    <Label htmlFor={`rejected-${item.id}`} className="font-normal">Show {rejectedCount} rejected</Label>
                  </div>
                )}
              </div>
            </div>

            {shown.length === 0 && active && <p className="text-sm text-muted-foreground">Candidates appear here as soon as each one is verified.</p>}

            {groupByRetailer ? (
              Object.keys(counts)
                .filter((code) => retailerFilter === ALL_RETAILERS || code === retailerFilter)
                .map((code) => (
                  <section key={code} aria-label={retailerNames[code] ?? code} className="space-y-2">
                    <h4 className="text-sm font-semibold">{retailerNames[code] ?? code}</h4>
                    <ul className={grid}>{shown.filter((m) => m.retailer_code === code).map(card)}</ul>
                  </section>
                ))
            ) : (
              <ul className={grid} aria-label={`Matches for ${item.title}`}>
                {shown.map(card)}
              </ul>
            )}

            {hiddenCount > 0 && (
              <Button variant="link" className="px-0" onClick={() => setShowAll(true)}>
                Show {hiddenCount} more
              </Button>
            )}

            {!active && !archived && goodCount < 2 && (
              <Alert>
                <AlertTitle>{goodCount === 0 ? 'No verified matches yet' : 'Only one verified match'}</AlertTitle>
                <AlertDescription>
                  Try loosening your constraints — raise the budget, remove brand filters, or allow refurbished — then search again.
                </AlertDescription>
              </Alert>
            )}

            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={onArchiveToggle} disabled={busy}>
                {archived ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />} {archived ? 'Unarchive' : 'Archive'}
              </Button>
              <Button variant="outline" onClick={onEdit} disabled={busy || archived}>
                <Pencil aria-hidden /> Edit
              </Button>
              <Button onClick={onFindMore} disabled={busy || active || archived}>
                <RefreshCw aria-hidden /> Find more
              </Button>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
