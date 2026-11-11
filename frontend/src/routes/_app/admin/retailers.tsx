/**
 * Admin ▸ Retailers: enable per country, country domains, rate limits.
 */
import { useEffect, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { AdminPageHeader } from '@/components/app/AdminLayout';
import { ErrorState } from '@/components/app/PageState';
import { useAdminRetailers, useSaveRetailer, useShopifyStoreCounts } from '@/data/admin';
import type { Retailer } from '@/data/types';
import { COUNTRIES } from '@/lib/markets';

export const Route = createFileRoute('/_app/admin/retailers')({
  component: RetailersPage,
});

function RetailersPage() {
  const retailers = useAdminRetailers();
  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Retailers"
        description="Leave a country's domain empty to make the retailer unavailable there. Shopify uses * (stores are discovered per country)."
      />
      {retailers.error && <ErrorState error={retailers.error} />}
      {retailers.isLoading && <Skeleton className="h-40" />}
      <div className="grid gap-4 lg:grid-cols-2">
        {(retailers.data ?? []).map((r) => (
          <RetailerCard key={r.id} retailer={r} />
        ))}
      </div>
    </div>
  );
}

function RetailerCard({ retailer }: { retailer: Retailer }) {
  const save = useSaveRetailer();
  const counts = useShopifyStoreCounts();
  const [domains, setDomains] = useState<Record<string, string>>({});
  const [crossBorder, setCrossBorder] = useState<string[]>([]);
  const [rate, setRate] = useState(retailer.rate_limit_per_min);

  useEffect(() => {
    setDomains(retailer.country_domains ?? {});
    setCrossBorder(retailer.cross_border_countries ?? []);
    setRate(retailer.rate_limit_per_min);
  }, [retailer]);

  const isShopify = retailer.code === 'shopify';

  return (
    <Card className="min-w-0">
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="min-w-0 text-lg">
          <h2 className="break-words">
            {retailer.display_name} <code className="text-xs font-normal text-muted-foreground">{retailer.adapter_key}</code>
          </h2>
        </CardTitle>
        <div className="flex items-center gap-2">
          <Label htmlFor={`enabled-${retailer.code}`} className="font-normal">
            Enabled
          </Label>
          <Switch
            id={`enabled-${retailer.code}`}
            checked={retailer.is_enabled}
            onCheckedChange={(v) => save.mutate({ id: retailer.id, is_enabled: v })}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {COUNTRIES.map((c) => (
          <div key={c.code} className="grid grid-cols-[6rem_minmax(0,1fr)_auto] items-center gap-2">
            <Label htmlFor={`domain-${retailer.code}-${c.code}`}>{c.name}</Label>
            <Input
              id={`domain-${retailer.code}-${c.code}`}
              value={domains[c.code] ?? ''}
              placeholder="not available"
              onChange={(e) => setDomains({ ...domains, [c.code]: e.target.value })}
            />
            <div className="flex items-center gap-1">
              <Checkbox
                id={`xb-${retailer.code}-${c.code}`}
                checked={crossBorder.includes(c.code)}
                onCheckedChange={(v) => setCrossBorder(v === true ? [...crossBorder, c.code] : crossBorder.filter((x) => x !== c.code))}
              />
              <Label htmlFor={`xb-${retailer.code}-${c.code}`} className="text-xs font-normal">
                cross-border
              </Label>
            </div>
          </div>
        ))}
        <div className="grid grid-cols-[6rem_8rem] items-center gap-2">
          <Label htmlFor={`rate-${retailer.code}`}>Rate limit</Label>
          <Input id={`rate-${retailer.code}`} type="number" min={1} value={rate} onChange={(e) => setRate(Number(e.target.value))} aria-describedby={`rate-hint-${retailer.code}`} />
        </div>
        <p id={`rate-hint-${retailer.code}`} className="text-xs text-muted-foreground">Requests per minute, per worker.</p>
        {isShopify && counts.data && (
          <p className="text-sm">
            Discovery on · {counts.data.total} stores ({counts.data.blocked} blocked, {counts.data.seed} seed){' '}
            <Link to="/admin/stores" className="text-primary underline-offset-4 hover:underline">
              Review
            </Link>
          </p>
        )}
      </CardContent>
      <CardFooter className="justify-between">
        <div className="flex flex-wrap gap-1">
          {Object.entries(domains)
            .filter(([, d]) => d)
            .map(([cc]) => (
              <Badge key={cc} variant="secondary">
                {cc}
                {crossBorder.includes(cc) ? '*' : ''}
              </Badge>
            ))}
        </div>
        <Button
          size="sm"
          disabled={save.isPending || rate < 1}
          onClick={() =>
            save.mutate({
              id: retailer.id,
              country_domains: Object.fromEntries(Object.entries(domains).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v)),
              cross_border_countries: crossBorder,
              rate_limit_per_min: rate,
            })
          }
        >
          Save
        </Button>
      </CardFooter>
    </Card>
  );
}
