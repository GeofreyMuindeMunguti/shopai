import { Check, Loader2, AlertTriangle, MinusCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { RetailerResult } from '@/data/types';

interface RetailerProgressProps {
  retailerCodes: string[];
  results: Record<string, RetailerResult>;
  retailerNames: Record<string, string>;
  /** True while the run is queued/running: retailers without a result show as in progress. */
  active: boolean;
  className?: string;
}

function describe(name: string, result: RetailerResult | undefined, active: boolean) {
  const status = result?.status ?? (active ? 'running' : 'skipped');
  switch (status) {
    case 'completed':
      return { icon: Check, text: `${name} ✓ ${result?.matches ?? 0}`, label: `${name}: ${result?.matches ?? 0} found`, tone: 'ok' };
    case 'no_matches':
      return { icon: MinusCircle, text: `No matches on ${name}`, label: `No matches on ${name}`, tone: 'muted' };
    case 'retrying':
      return { icon: AlertTriangle, text: `${name} unavailable, retrying`, label: `${name} unavailable, retrying`, tone: 'warn' };
    case 'failed':
      return { icon: AlertTriangle, text: `${name} unavailable`, label: `${name} unavailable${result?.error ? `: ${result.error}` : ''}`, tone: 'warn' };
    case 'skipped':
      return { icon: MinusCircle, text: `${name} skipped`, label: `${name} was not searched`, tone: 'muted' };
    default:
      return {
        icon: Loader2,
        text: `${name}${result?.matches ? ` ${result.matches}` : ''} ◌`,
        label: `${name}: searching${result?.matches ? `, ${result.matches} found so far` : ''}`,
        tone: 'active',
      };
  }
}

/** Per-retailer chips: "Takealot ✓ 2 · Amazon ◌ · Jumia unavailable, retrying". */
export function RetailerProgress({ retailerCodes, results, retailerNames, active, className }: RetailerProgressProps) {
  if (retailerCodes.length === 0) return null;
  return (
    <ul className={cn('flex flex-wrap gap-1.5', className)} aria-label="Search progress by retailer">
      {retailerCodes.map((code) => {
        const d = describe(retailerNames[code] ?? code, results[code], active);
        const Icon = d.icon;
        return (
          <li key={code}>
            <Badge
              variant="outline"
              title={d.label}
              aria-label={d.label}
              className={cn(
                'gap-1 font-medium',
                d.tone === 'ok' && 'border-success/40 text-success',
                d.tone === 'warn' && 'border-warning/40 text-warning',
                d.tone === 'muted' && 'text-muted-foreground'
              )}
            >
              <Icon className={cn('h-3 w-3', d.tone === 'active' && 'animate-spin')} aria-hidden />
              {d.text}
            </Badge>
          </li>
        );
      })}
    </ul>
  );
}
