/**
 * Thin engine wrappers that expose Scout domain components to JSON pages
 * (ADR-0010 layer 3). No domain logic here: props in, actions out.
 */
import { CandidateCard } from '@/components/app/CandidateCard';
import { ModelSelector } from '@/components/app/ModelSelector';
import { PriceWithConversion } from '@/components/app/PriceWithConversion';
import { RetailerProgress } from '@/components/app/RetailerProgress';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useFx } from '@/data/queries';
import type { AvailableModel, ProductMatch, RetailerResult } from '@/data/types';
import { useUIEngine } from '@/engine/UIEngineContext';
import type { ActionDefinition, EngineComponentProps } from '@/engine/types';
import { formatDateTime, maskEmail, timeAgo } from '@/lib/format';

/** Text helper for values JSON expressions can't format: masked emails and dates. */
export function EngineFormattedText(props: EngineComponentProps) {
  const { value, format, className } = props as { value?: string | null; format?: 'maskedEmail' | 'datetime' | 'timeAgo'; className?: string };
  const text = format === 'maskedEmail' ? maskEmail(value) : format === 'datetime' ? formatDateTime(value) : format === 'timeAgo' ? timeAgo(value) : value ?? '';
  return <span className={className}>{text}</span>;
}

export function EngineSwitch(props: EngineComponentProps) {
  const { checked, label, name, disabled, onChange } = props as {
    checked?: boolean;
    label?: string;
    name?: string;
    disabled?: boolean;
    onChange?: ActionDefinition;
  };
  const { dispatch } = useUIEngine();
  const id = name ?? `switch-${label}`;
  return (
    <div className="flex items-center gap-2">
      <Switch id={id} checked={Boolean(checked)} disabled={disabled} onCheckedChange={(v) => onChange && dispatch(onChange, { event: { target: { checked: v, value: v } } })} />
      {label && <Label htmlFor={id} className="font-normal">{label}</Label>}
    </div>
  );
}

export function EngineCandidateCard(props: EngineComponentProps) {
  const { match, retailerName, displayCurrency, onDecide } = props as {
    match: ProductMatch;
    retailerName?: string;
    displayCurrency?: string;
    onDecide?: ActionDefinition;
  };
  const { dispatch } = useUIEngine();
  const fx = useFx();
  if (!match) return null;
  return (
    <CandidateCard
      match={match}
      retailerName={retailerName ?? match.retailer_code}
      displayCurrency={displayCurrency ?? match.currency ?? 'USD'}
      fx={fx.data}
      onDecide={onDecide ? (decision, reason) => dispatch(onDecide, { event: { decision, reason, match } }) : undefined}
    />
  );
}

export function EngineModelSelector(props: EngineComponentProps) {
  const { models, value, label, onChange } = props as { models?: AvailableModel[]; value?: string | null; label?: string; onChange?: ActionDefinition };
  const { dispatch } = useUIEngine();
  return (
    <ModelSelector
      models={models ?? []}
      value={value ?? null}
      label={label}
      onChange={(id) => onChange && dispatch(onChange, { event: { target: { value: id } } })}
    />
  );
}

export function EngineRetailerProgress(props: EngineComponentProps) {
  const { retailerCodes, results, retailerNames, active } = props as {
    retailerCodes?: string[];
    results?: Record<string, RetailerResult>;
    retailerNames?: Record<string, string>;
    active?: boolean;
  };
  return <RetailerProgress retailerCodes={retailerCodes ?? []} results={results ?? {}} retailerNames={retailerNames ?? {}} active={Boolean(active)} />;
}

export function EnginePriceWithConversion(props: EngineComponentProps) {
  const { amount, currency, displayCurrency } = props as { amount?: number | null; currency?: string | null; displayCurrency?: string };
  const fx = useFx();
  return <PriceWithConversion amount={amount ?? null} currency={currency ?? null} displayCurrency={displayCurrency ?? currency ?? 'USD'} fx={fx.data} />;
}
