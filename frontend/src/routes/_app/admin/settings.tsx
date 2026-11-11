/**
 * Admin ▸ Limits & rollout: feature flag, beta allowlist, daily cap, FX refresh.
 */
import { useEffect, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { AdminPageHeader } from '@/components/app/AdminLayout';
import { ErrorState } from '@/components/app/PageState';
import { useAppSettings, useRequestFxRefresh, useSaveAppSetting } from '@/data/admin';
import { useFx } from '@/data/queries';
import { FX_ATTRIBUTION } from '@/lib/fx';
import { formatDate } from '@/lib/format';

export const Route = createFileRoute('/_app/admin/settings')({
  component: AdminSettingsPage,
});

function AdminSettingsPage() {
  const settings = useAppSettings();
  const save = useSaveAppSetting();
  const fx = useFx();
  const refreshFx = useRequestFxRefresh();
  const get = (key: string) => settings.data?.find((s) => s.key === key)?.value;

  const [cap, setCap] = useState('20');
  const [allowlist, setAllowlist] = useState('');
  useEffect(() => {
    if (!settings.data) return;
    setCap(String(get('scout_daily_cap') ?? 20));
    setAllowlist(((get('scout_beta_allowlist') as string[] | undefined) ?? []).join('\n'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.data]);

  const emails = allowlist
    .split(/[\s,]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  return (
    <div className="space-y-6">
      <AdminPageHeader title="Limits & rollout" description="Cost controls and beta access. Changes take effect for new searches immediately." />
      {settings.error && <ErrorState error={settings.error} />}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg"><h2>Scouting</h2></CardTitle>
          <CardDescription>Turning scouting off blocks new runs; runs already in progress finish.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center gap-2">
            <Switch id="flag-enabled" checked={get('wishlist_scout_enabled') === true} onCheckedChange={(v) => save.mutate({ key: 'wishlist_scout_enabled', value: v })} />
            <Label htmlFor="flag-enabled" className="font-normal">Scouting enabled (wishlist_scout_enabled)</Label>
          </div>
          <div className="flex items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="daily-cap">Searches per user per day</Label>
              <Input id="daily-cap" type="number" min={0} className="w-32" value={cap} onChange={(e) => setCap(e.target.value)} />
            </div>
            <Button variant="outline" disabled={!/^\d+$/.test(cap)} onClick={() => save.mutate({ key: 'scout_daily_cap', value: Number(cap) })}>
              Save cap
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg"><h2>Beta allowlist</h2></CardTitle>
          <CardDescription>When on, only these emails can start searches.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <Switch id="allowlist-on" checked={get('scout_beta_allowlist_enabled') === true} onCheckedChange={(v) => save.mutate({ key: 'scout_beta_allowlist_enabled', value: v })} />
            <Label htmlFor="allowlist-on" className="font-normal">Restrict to allowlist</Label>
          </div>
          <div className="space-y-1">
            <Label htmlFor="allowlist">Emails (one per line)</Label>
            <Textarea id="allowlist" rows={6} value={allowlist} onChange={(e) => setAllowlist(e.target.value)} />
          </div>
          <Button variant="outline" onClick={() => save.mutate({ key: 'scout_beta_allowlist', value: emails })}>
            Save allowlist ({emails.length})
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg"><h2>Exchange rates</h2></CardTitle>
          <CardDescription>Refreshed daily. {FX_ATTRIBUTION}; fallback: fawazahmed0 currency-api.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="text-sm">
            {Object.entries(fx.data?.rates ?? {})
              .filter(([c]) => c !== 'USD')
              .map(([c, r]) => (
                <li key={c}>
                  1 USD = {r.toLocaleString('en-US', { maximumFractionDigits: 4 })} {c}{' '}
                  <span className="text-muted-foreground">(as of {formatDate(fx.data?.asOf[c])})</span>
                </li>
              ))}
            {Object.keys(fx.data?.rates ?? {}).length <= 1 && <li className="text-muted-foreground">No rates from the last 72 hours — conversions are hidden.</li>}
          </ul>
          <Button variant="outline" disabled={refreshFx.isPending} onClick={() => refreshFx.mutate()}>
            Refresh now
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
