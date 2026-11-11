import { useEffect, useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import type { ItemInput } from '@/data/queries';
import type { Condition, CountryCode, RescoutFrequency, Retailer, WishlistItem } from '@/data/types';
import { COUNTRIES, CURRENCIES, retailersForCountry } from '@/lib/markets';

interface ItemFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Existing item when editing; prefill (title only) when adding from an example. */
  item?: WishlistItem | null;
  prefillTitle?: string;
  retailers: Retailer[];
  profileRetailers: string[];
  defaultCurrency: string;
  defaultCountry: CountryCode | null;
  busy?: boolean;
  onSubmit: (input: ItemInput) => void;
}

const NONE = '__none';

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Search-relevant fields; editing any of them offers a re-scout. */
export function searchFieldsChanged(before: WishlistItem, after: ItemInput): boolean {
  const pick = (i: Partial<ItemInput>) =>
    JSON.stringify([i.title, i.description ?? null, i.reference_url ?? null, i.max_price ?? null, i.currency ?? null, i.constraints ?? {}, i.retailer_codes ?? null]);
  return pick(before) !== pick(after);
}

export function ItemFormDialog({
  open,
  onOpenChange,
  item,
  prefillTitle,
  retailers,
  profileRetailers,
  defaultCurrency,
  defaultCountry,
  busy,
  onSubmit,
}: ItemFormDialogProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [referenceUrl, setReferenceUrl] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [currency, setCurrency] = useState(defaultCurrency);
  const [brands, setBrands] = useState('');
  const [excludeBrands, setExcludeBrands] = useState('');
  const [condition, setCondition] = useState<Condition>('new');
  const [attributes, setAttributes] = useState<{ key: string; value: string }[]>([]);
  const [shipTo, setShipTo] = useState<string>(NONE);
  const [overrideRetailers, setOverrideRetailers] = useState(false);
  const [retailerCodes, setRetailerCodes] = useState<string[]>(profileRetailers);
  const [frequency, setFrequency] = useState<RescoutFrequency>('off');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const c = item?.constraints ?? {};
    setTitle(item?.title ?? prefillTitle ?? '');
    setDescription(item?.description ?? '');
    setReferenceUrl(item?.reference_url ?? '');
    setMaxPrice(item?.max_price != null ? String(item.max_price) : '');
    setCurrency(item?.currency ?? defaultCurrency);
    setBrands((c.brands ?? []).join(', '));
    setExcludeBrands((c.exclude_brands ?? []).join(', '));
    setCondition(c.condition ?? 'new');
    setAttributes(Object.entries(c.attributes ?? {}).map(([key, value]) => ({ key, value: String(value) })));
    setShipTo(c.ship_to_country ?? NONE);
    setOverrideRetailers(Boolean(item?.retailer_codes));
    setRetailerCodes(item?.retailer_codes ?? profileRetailers);
    setFrequency(item?.rescout_frequency ?? 'off');
    setError(null);
  }, [open, item, prefillTitle, defaultCurrency, profileRetailers]);

  const country = shipTo !== NONE ? shipTo : defaultCountry;
  const available = retailersForCountry(retailers, country);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return setError('Give the item a title.');
    if (referenceUrl && !/^https?:\/\//i.test(referenceUrl)) return setError('Reference link must start with http:// or https://');
    const price = maxPrice ? Number(maxPrice) : null;
    if (price !== null && (!Number.isFinite(price) || price <= 0)) return setError('Max price must be a positive number.');
    if (overrideRetailers && retailerCodes.length === 0) return setError('Choose at least one retailer, or use your default retailers.');

    const attrs = Object.fromEntries(attributes.filter((a) => a.key.trim() && a.value.trim()).map((a) => [a.key.trim(), a.value.trim()]));
    const constraints: ItemInput['constraints'] = {};
    const b = splitList(brands);
    const xb = splitList(excludeBrands);
    if (b.length) constraints.brands = b;
    if (xb.length) constraints.exclude_brands = xb;
    constraints.condition = condition;
    if (Object.keys(attrs).length) constraints.attributes = attrs;
    if (shipTo !== NONE) constraints.ship_to_country = shipTo as CountryCode;

    onSubmit({
      title: title.trim(),
      description: description.trim() || null,
      reference_url: referenceUrl.trim() || null,
      max_price: price,
      currency: price !== null ? currency : item?.currency ?? null,
      constraints,
      retailer_codes: overrideRetailers ? retailerCodes.filter((c) => available.some((r) => r.code === c)) : null,
      rescout_frequency: frequency,
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
        <form onSubmit={handleSubmit} className="space-y-5" noValidate>
          <SheetHeader>
            <SheetTitle>{item ? 'Edit item' : 'Add item'}</SheetTitle>
            <SheetDescription>
              Describe what you want. Only the title is required — Scout searches your retailers as soon as you save.
            </SheetDescription>
          </SheetHeader>

          <div className="space-y-2">
            <Label htmlFor="item-title">
              What are you looking for? <span className="text-destructive">*</span>
            </Label>
            <Input
              id="item-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Noise-cancelling over-ear headphones, black"
              required
              aria-invalid={Boolean(error && !title.trim())}
              maxLength={200}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="item-description">Details</Label>
            <Textarea id="item-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Anything that matters: features, use, deal-breakers" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="item-url">Reference link</Label>
            <Input id="item-url" type="url" inputMode="url" value={referenceUrl} onChange={(e) => setReferenceUrl(e.target.value)} placeholder="https://…" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="item-max-price">Max price</Label>
              <Input id="item-max-price" type="number" min="0" step="any" inputMode="decimal" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="item-currency">Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger id="item-currency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.code}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="item-brands">Brands</Label>
              <Input id="item-brands" value={brands} onChange={(e) => setBrands(e.target.value)} placeholder="Sony, Bose" aria-describedby="brands-hint" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="item-exclude">Exclude brands</Label>
              <Input id="item-exclude" value={excludeBrands} onChange={(e) => setExcludeBrands(e.target.value)} aria-describedby="brands-hint" />
            </div>
            <p id="brands-hint" className="col-span-2 text-xs text-muted-foreground">Separate brands with commas.</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="item-condition">Condition</Label>
              <Select value={condition} onValueChange={(v) => setCondition(v as Condition)}>
                <SelectTrigger id="item-condition">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="new">New</SelectItem>
                  <SelectItem value="refurb">Refurbished</SelectItem>
                  <SelectItem value="used">Used</SelectItem>
                  <SelectItem value="any">Any</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="item-ship-to">Ship to</Label>
              <Select value={shipTo} onValueChange={setShipTo}>
                <SelectTrigger id="item-ship-to">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>My country</SelectItem>
                  {COUNTRIES.map((c) => (
                    <SelectItem key={c.code} value={c.code}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Attributes</legend>
            {attributes.map((a, i) => (
              <div key={i} className="flex gap-2">
                <Input aria-label={`Attribute ${i + 1} name`} placeholder="size" value={a.key} onChange={(e) => setAttributes(attributes.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))} />
                <Input aria-label={`Attribute ${i + 1} value`} placeholder="10" value={a.value} onChange={(e) => setAttributes(attributes.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} />
                <Button type="button" variant="ghost" size="icon" aria-label={`Remove attribute ${i + 1}`} onClick={() => setAttributes(attributes.filter((_, j) => j !== i))}>
                  <Trash2 aria-hidden />
                </Button>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={() => setAttributes([...attributes, { key: '', value: '' }])}>
              <Plus aria-hidden /> Add attribute
            </Button>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Retailers</legend>
            <div className="flex items-center gap-2">
              <Checkbox id="override-retailers" checked={overrideRetailers} onCheckedChange={(v) => setOverrideRetailers(v === true)} />
              <Label htmlFor="override-retailers" className="font-normal">
                Choose retailers for this item (otherwise your default retailers are searched)
              </Label>
            </div>
            {overrideRetailers && (
              <div className="grid grid-cols-2 gap-2 pl-6">
                {available.map((r) => (
                  <div key={r.code} className="flex items-center gap-2">
                    <Checkbox
                      id={`item-retailer-${r.code}`}
                      checked={retailerCodes.includes(r.code)}
                      onCheckedChange={(v) => setRetailerCodes(v === true ? [...retailerCodes, r.code] : retailerCodes.filter((c) => c !== r.code))}
                    />
                    <Label htmlFor={`item-retailer-${r.code}`} className="font-normal">
                      {r.display_name}
                    </Label>
                  </div>
                ))}
              </div>
            )}
          </fieldset>

          <div className="space-y-2">
            <Label htmlFor="item-frequency">Check for new or cheaper matches</Label>
            <Select value={frequency} onValueChange={(v) => setFrequency(v as RescoutFrequency)}>
              <SelectTrigger id="item-frequency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="off">Off</SelectItem>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}

          <SheetFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {item ? 'Save changes' : 'Save & search'}
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
