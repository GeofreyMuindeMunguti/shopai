import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

export const ALL_RETAILERS = '__all';

interface RetailerFilterChipsProps {
  counts: Record<string, number>;
  retailerNames: Record<string, string>;
  value: string;
  onChange: (value: string) => void;
}

/** [All 5] [Takealot 2] [Amazon 1] [Shopify 2] */
export function RetailerFilterChips({ counts, retailerNames, value, onChange }: RetailerFilterChipsProps) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const codes = Object.keys(counts).sort((a, b) => (retailerNames[a] ?? a).localeCompare(retailerNames[b] ?? b));
  if (codes.length < 2) return null;
  return (
    <ToggleGroup
      type="single"
      size="sm"
      variant="outline"
      value={value}
      onValueChange={(v) => onChange(v || ALL_RETAILERS)}
      aria-label="Filter matches by retailer"
    >
      <ToggleGroupItem value={ALL_RETAILERS}>All {total}</ToggleGroupItem>
      {codes.map((code) => (
        <ToggleGroupItem key={code} value={code}>
          {retailerNames[code] ?? code} {counts[code]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
