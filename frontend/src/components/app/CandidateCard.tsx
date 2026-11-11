import { useState } from 'react';
import { Check, ChevronDown, ExternalLink, History, ImageOff, Star, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { AVAILABILITY_LABEL, formatPercent, timeAgo } from '@/lib/format';
import type { FxTable } from '@/lib/fx';
import type { Decision, ProductMatch } from '@/data/types';
import { PriceWithConversion } from './PriceWithConversion';
import { RejectReasonDialog } from './RejectReasonDialog';
import { PriceHistoryDialog } from './PriceHistoryDialog';

export interface CandidateCardProps {
  match: ProductMatch;
  retailerName: string;
  displayCurrency: string;
  fx: FxTable | undefined;
  /** First proposed by the latest run (scheduled updates) → "New" badge. */
  isNew?: boolean;
  /** Found before the item's constraints were last edited. */
  isOutdated?: boolean;
  busy?: boolean;
  onDecide?: (decision: Decision, reason?: string | null) => void;
}

const STATUS_BADGE: Partial<Record<ProductMatch['status'], { label: string; className: string }>> = {
  approved: { label: 'Chosen', className: 'border-transparent bg-success text-success-foreground' },
  saved: { label: 'Saved', className: '' },
  rejected: { label: 'Rejected', className: 'text-muted-foreground' },
  stale: { label: 'No longer available', className: 'border-warning/40 text-warning' },
  unverified: { label: 'Unverified', className: 'border-warning/40 text-warning' },
};

export function CandidateCard({ match, retailerName, displayCurrency, fx, isNew, isOutdated, busy, onDecide }: CandidateCardProps) {
  const [whyOpen, setWhyOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const isShopify = match.retailer_code === 'shopify';
  const status = STATUS_BADGE[match.status];
  const decided = match.status === 'approved' || match.status === 'rejected' || match.status === 'saved';
  const titleId = `match-${match.id}-title`;

  return (
    <Card
      aria-labelledby={titleId}
      className={cn('flex h-full flex-col overflow-hidden', match.status === 'approved' && 'ring-2 ring-success', match.status === 'rejected' && 'opacity-70')}
    >
      <div className="relative aspect-[4/3] bg-muted">
        {match.image_url ? (
          <img src={match.image_url} alt="" loading="lazy" referrerPolicy="no-referrer" className="h-full w-full object-contain" />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            <ImageOff className="h-8 w-8" aria-hidden />
            <span className="sr-only">No image</span>
          </div>
        )}
        <div className="absolute left-2 top-2 flex flex-wrap gap-1">
          {isNew && <Badge>New</Badge>}
          {match.best_for_retailer && (
            <Badge variant="outline" className="bg-background">
              Best on {retailerName}
            </Badge>
          )}
          {status && (
            <Badge variant="outline" className={cn('bg-background', status.className)}>
              {status.label}
            </Badge>
          )}
        </div>
      </div>

      <CardContent className="flex flex-1 flex-col gap-2 p-4">
        <h4 id={titleId} className="line-clamp-2 font-medium leading-snug">
          {match.title}
        </h4>
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <Badge variant="secondary">{retailerName}</Badge>
          {isShopify && <Badge variant="outline">Independent store</Badge>}
          <span className="text-muted-foreground">{match.store_domain}</span>
        </div>

        <PriceWithConversion amount={match.price} currency={match.currency} displayCurrency={displayCurrency} fx={fx} />

        <p className="text-sm text-muted-foreground">
          {AVAILABILITY_LABEL[match.availability ?? 'unknown']} · {match.store_domain} · checked {timeAgo(match.verified_at)}
        </p>
        {match.price_may_vary && <p className="text-sm text-warning">Price may vary by session or region.</p>}
        {match.is_cross_border && <p className="text-sm text-warning">Ships internationally — import duties may apply.</p>}
        {isOutdated && <p className="text-sm text-muted-foreground">Found before your last edit — possibly outdated.</p>}
        {match.status === 'rejected' && match.decision_reason && (
          <p className="text-sm text-muted-foreground">Your reason: {match.decision_reason}</p>
        )}

        <div className="mt-auto flex items-center justify-between pt-1">
          <TooltipProvider delayDuration={200}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0} className="text-sm font-semibold">
                  {formatPercent(match.match_score)} match
                </span>
              </TooltipTrigger>
              <TooltipContent>How closely the agent thinks this fits your description and constraints.</TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <a
            href={match.product_url}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="inline-flex items-center gap-1 text-sm text-primary underline-offset-4 hover:underline"
          >
            View <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            <span className="sr-only">{match.title} on {match.store_domain} (opens in a new tab)</span>
          </a>
        </div>

        {match.rationale && (
          <Collapsible open={whyOpen} onOpenChange={setWhyOpen}>
            <CollapsibleTrigger className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              why? <ChevronDown className={cn('h-4 w-4 transition-transform', whyOpen && 'rotate-180')} aria-hidden />
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-1 text-sm">{match.rationale}</CollapsibleContent>
          </Collapsible>
        )}
      </CardContent>

      {onDecide && match.status !== 'unverified' && (
        <CardFooter className="gap-1 p-2 pt-0">
          <Button
            size="sm"
            variant={match.status === 'approved' ? 'default' : 'outline'}
            className="flex-1"
            disabled={busy || match.status === 'stale' || match.status === 'approved'}
            onClick={() => onDecide('approve')}
            aria-label={`Approve ${match.title}`}
          >
            <Check aria-hidden /> {match.status === 'approved' ? 'Chosen' : 'Approve'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || match.status === 'rejected'}
            onClick={() => setRejectOpen(true)}
            aria-label={`Reject ${match.title}`}
          >
            <X aria-hidden />
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || match.status === 'saved'}
            onClick={() => onDecide('save')}
            aria-label={`Save ${match.title} for later`}
          >
            <Star aria-hidden />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setHistoryOpen(true)} aria-label={`Price history for ${match.title}`}>
            <History aria-hidden />
          </Button>
          {decided && <span className="sr-only">Current decision: {match.status}</span>}
        </CardFooter>
      )}

      <RejectReasonDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        productTitle={match.title}
        onConfirm={(reason) => {
          setRejectOpen(false);
          onDecide?.('reject', reason);
        }}
      />
      <PriceHistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} match={match} />
    </Card>
  );
}
