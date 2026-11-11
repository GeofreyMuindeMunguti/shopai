/**
 * Settings: profile & defaults, linked accounts (JSON engine page),
 * notifications, data rights (export / delete).
 */
import { useEffect, useMemo, useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { toast } from 'sonner';
import { Download, Trash2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ModelSelector } from '@/components/app/ModelSelector';
import { UIEngine } from '@/engine';
import type { PageDefinition } from '@/engine/types';
import linkedAccountsPage from '@/pages/linked-accounts.json';
import { supabase } from '@/data/supabase';
import {
  unwrap,
  useAvailableModels,
  useMarkNotificationRead,
  useNotifications,
  useProfile,
  useRetailers,
  useUpdateProfile,
} from '@/data/queries';
import type { CountryCode, CurrencyCode } from '@/data/types';
import { useAuth } from '@/hooks/useAuth';
import { toastError } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { COUNTRIES, CURRENCIES, retailersForCountry } from '@/lib/markets';
import { cn } from '@/lib/utils';

const TABS = ['profile', 'accounts', 'notifications', 'privacy'] as const;
type Tab = (typeof TABS)[number];

export const Route = createFileRoute('/_app/settings')({
  validateSearch: (search: Record<string, unknown>): { tab?: Tab } => ({
    tab: TABS.includes(search.tab as Tab) ? (search.tab as Tab) : undefined,
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { tab = 'profile' } = Route.useSearch();
  const navigate = useNavigate({ from: '/settings' });
  const { user } = useAuth();

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      <Tabs value={tab} onValueChange={(t) => navigate({ search: { tab: t as Tab } })}>
        <TabsList>
          <TabsTrigger value="profile">Shopping preferences</TabsTrigger>
          <TabsTrigger value="accounts">Linked accounts</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="privacy">Your data</TabsTrigger>
        </TabsList>
        <TabsContent value="profile">
          <ProfileSettings />
        </TabsContent>
        <TabsContent value="accounts">
          {user && <UIEngine page={linkedAccountsPage as PageDefinition} params={{ userId: user.id }} />}
        </TabsContent>
        <TabsContent value="notifications">
          <NotificationSettings />
        </TabsContent>
        <TabsContent value="privacy">
          <PrivacySettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function ProfileSettings() {
  const { data: profile } = useProfile();
  const retailers = useRetailers();
  const models = useAvailableModels();
  const update = useUpdateProfile();
  const [country, setCountry] = useState<CountryCode>('US');
  const [currency, setCurrency] = useState<CurrencyCode>('USD');
  const [codes, setCodes] = useState<string[]>([]);
  const [modelId, setModelId] = useState<string | null>(null);

  useEffect(() => {
    if (!profile) return;
    setCountry(profile.country_code ?? 'US');
    setCurrency(profile.currency ?? 'USD');
    setCodes(profile.retailer_codes ?? []);
    setModelId(profile.model_id);
  }, [profile]);

  const available = useMemo(() => retailersForCountry(retailers.data ?? [], country), [retailers.data, country]);
  const validCodes = codes.filter((c) => available.some((r) => r.code === c));
  const modelAvailable = !modelId || (models.data ?? []).some((m) => m.id === modelId);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">
          <h2>Shopping preferences</h2>
        </CardTitle>
        <CardDescription>Used for new wishlists and items. Each item can still override retailers.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="settings-country">Country</Label>
            <Select
              value={country}
              onValueChange={(v) => {
                setCountry(v as CountryCode);
                setCodes(retailersForCountry(retailers.data ?? [], v).map((r) => r.code));
              }}
            >
              <SelectTrigger id="settings-country">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COUNTRIES.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="settings-currency">Currency</Label>
            <Select value={currency} onValueChange={(v) => setCurrency(v as CurrencyCode)}>
              <SelectTrigger id="settings-currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Retailers to search</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {available.map((r) => (
              <div key={r.code} className="flex items-center gap-2">
                <Checkbox
                  id={`settings-retailer-${r.code}`}
                  checked={validCodes.includes(r.code)}
                  onCheckedChange={(v) => setCodes(v === true ? [...validCodes, r.code] : validCodes.filter((c) => c !== r.code))}
                />
                <Label htmlFor={`settings-retailer-${r.code}`} className="font-normal">
                  {r.display_name}
                </Label>
              </div>
            ))}
          </div>
          {validCodes.length === 0 && <p role="alert" className="text-sm text-destructive">Choose at least one retailer.</p>}
        </fieldset>
        <div className="max-w-md">
          <ModelSelector models={models.data ?? []} value={modelAvailable ? modelId : null} onChange={setModelId} label="Default AI model" id="settings-model" />
          {!modelAvailable && <p className="mt-1 text-sm text-warning">Your previous default model is no longer available. Pick another one.</p>}
        </div>
      </CardContent>
      <CardFooter>
        <Button
          disabled={update.isPending || validCodes.length === 0}
          onClick={() =>
            update.mutate(
              { country_code: country, currency, retailer_codes: validCodes, model_id: modelAvailable ? modelId : null },
              { onSuccess: () => toast.success('Preferences saved') }
            )
          }
        >
          Save preferences
        </Button>
      </CardFooter>
    </Card>
  );
}

function NotificationSettings() {
  const { data = [], isLoading } = useNotifications();
  const markRead = useMarkNotificationRead();
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-xl">
          <h2>Notifications</h2>
        </CardTitle>
        <Button variant="outline" size="sm" disabled={!data.some((n) => !n.read_at)} onClick={() => markRead.mutate('all')}>
          Mark all read
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p>Loading…</p>
        ) : data.length === 0 ? (
          <p className="text-muted-foreground">No notifications yet. We'll tell you about new matches, price drops and changes to your models.</p>
        ) : (
          <ul className="divide-y">
            {data.map((n) => (
              <li key={n.id} className={cn('flex items-start justify-between gap-4 py-3', !n.read_at && 'font-medium')}>
                <div className="min-w-0 break-words">
                  <p>
                    {!n.read_at && <span className="sr-only">Unread: </span>}
                    {n.title}
                  </p>
                  {n.body && <p className="text-sm font-normal text-muted-foreground">{n.body}</p>}
                  <p className="text-xs font-normal text-muted-foreground">{formatDateTime(n.created_at)}</p>
                </div>
                {!n.read_at && (
                  <Button variant="ghost" size="sm" onClick={() => markRead.mutate(n.id)}>
                    Mark read
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function PrivacySettings() {
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  async function exportData() {
    try {
      const data = await unwrap<unknown>(supabase.rpc('export_my_data'));
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `scout-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toastError(e, 'Export failed');
    }
  }

  async function deleteAccount() {
    setBusy(true);
    try {
      await unwrap<unknown>(supabase.rpc('delete_my_account'));
      await signOut();
      toast.success('Your account and data were deleted');
      navigate({ to: '/login' });
    } catch (e) {
      toastError(e, 'Could not delete your account');
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">
          <h2>Your data</h2>
        </CardTitle>
        <CardDescription>Download everything we hold about you, or delete your account and all its data.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-3">
        <Button variant="outline" onClick={exportData}>
          <Download aria-hidden /> Export my data
        </Button>
        <AlertDialog onOpenChange={() => setConfirm('')}>
          <AlertDialogTrigger asChild>
            <Button variant="destructive">
              <Trash2 aria-hidden /> Delete my account
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete your account?</AlertDialogTitle>
              <AlertDialogDescription>
                This permanently removes your wishlists, items, matches, linked accounts and history. It can't be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2">
              <Label htmlFor="delete-confirm">Type DELETE to confirm</Label>
              <Input id="delete-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={confirm !== 'DELETE' || busy}
                onClick={(e) => {
                  e.preventDefault();
                  deleteAccount();
                }}
              >
                Delete everything
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
