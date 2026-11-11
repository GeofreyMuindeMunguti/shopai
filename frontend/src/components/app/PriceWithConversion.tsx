import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { formatDate, formatMoney, roundApprox } from '@/lib/format';
import { convert, FX_ATTRIBUTION, type FxTable } from '@/lib/fx';

interface PriceWithConversionProps {
  amount: number | null;
  currency: string | null;
  /** The user's profile currency. */
  displayCurrency: string;
  fx: FxTable | undefined;
  className?: string;
}

/**
 * Original price plus an approximate conversion, e.g. "US$129 ≈ KSh 16,700".
 * The conversion is display-only and hidden when rates are missing or > 72 h old.
 */
export function PriceWithConversion({ amount, currency, displayCurrency, fx, className }: PriceWithConversionProps) {
  if (amount === null || amount === undefined || !currency) {
    return <span className={cn('text-muted-foreground', className)}>Price unavailable</span>;
  }
  const conversion = fx && currency.toUpperCase() !== displayCurrency.toUpperCase()
    ? convert(Number(amount), currency, displayCurrency, fx)
    : null;

  return (
    <span className={cn('inline-flex flex-wrap items-baseline gap-x-1.5', className)}>
      <span className="font-semibold">{formatMoney(amount, currency)}</span>
      {conversion && (
        <TooltipProvider delayDuration={200}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                tabIndex={0}
                className="cursor-help text-sm text-muted-foreground underline decoration-dotted underline-offset-2"
                aria-label={`approximately ${formatMoney(roundApprox(conversion.amount), displayCurrency, { approx: true })}`}
              >
                ≈ {formatMoney(roundApprox(conversion.amount), displayCurrency, { approx: true })}
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p>Approximate conversion{conversion.asOf ? `, rates as of ${formatDate(conversion.asOf)}` : ''}.</p>
              <p className="text-xs text-muted-foreground">{FX_ATTRIBUTION}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </span>
  );
}
