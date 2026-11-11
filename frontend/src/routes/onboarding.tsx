/**
 * First-sign-in onboarding (FR-0b): location → retailers → default model → linked accounts.
 */
import { useEffect, useMemo, useState } from 'react';
import { createFileRoute, Navigate, useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { OnboardingStepper, type OnboardingStep } from '@/components/app/OnboardingStepper';
import { ErrorState, FullPageSpinner } from '@/components/app/PageState';
import { useAvailableModels, useLinkAccounts, useProfile, useRetailers, useUpdateProfile } from '@/data/queries';
import type { CountryCode, CurrencyCode } from '@/data/types';
import { useAuth } from '@/hooks/useAuth';
import { COUNTRIES, CURRENCIES, defaultCurrency, guessCountry, retailersForCountry } from '@/lib/markets';

export const Route = createFileRoute('/onboarding')({
  component: OnboardingPage,
});

const STEPS: OnboardingStep[] = [
  { title: 'Location', description: 'Where do you shop? This decides which retailers we can search and the currency we show.' },
  { title: 'Retailers', description: 'Which stores should Scout search? You can change this per item later.' },
  { title: 'AI model', description: 'Pick the default AI model for your searches.' },
  { title: 'Linked accounts', description: 'Optional. Tell us which account you use at each store.', optional: true },
];

interface LinkDraft {
  enabled: boolean;
  email: string;
  method: 'google_sso' | 'email';
}

function OnboardingPage() {
  const { session, isLoading, user } = useAuth();
  const profile = useProfile();
  const retailers = useRetailers();
  const models = useAvailableModels();
  const updateProfile = useUpdateProfile();
  const linkAccounts = useLinkAccounts();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [step, setStep] = useState(0);
  const [country, setCountry] = useState<CountryCode>(guessCountry());
  const [currency, setCurrency] = useState<CurrencyCode>(defaultCurrency(guessCountry()));
  const [selected, setSelected] = useState<string[] | null>(null);
  const [modelId, setModelId] = useState<string | null>(null);
  const [links, setLinks] = useState<Record<string, LinkDraft>>({});

  const available = useMemo(() => retailersForCountry(retailers.data ?? [], country), [retailers.data, country]);
  const platformModels = (models.data ?? []).filter((m) => m.model_group === 'platform');
  const retailerCodes = selected ?? available.map((r) => r.code);

  // Pre-fill from an existing (partially completed) profile.
  useEffect(() => {
    const p = profile.data;
    if (!p) return;
    if (p.country_code) setCountry(p.country_code);
    if (p.currency) setCurrency(p.currency);
    if (p.retailer_codes?.length) setSelected(p.retailer_codes);
    if (p.model_id) setModelId(p.model_id);
  }, [profile.data]);

  useEffect(() => {
    if (!modelId && platformModels.length) setModelId(platformModels.find((m) => m.is_default)?.id ?? platformModels[0].id);
  }, [platformModels, modelId]);

  if (isLoading || profile.isLoading) return <FullPageSpinner />;
  if (!session) return <Navigate to="/login" />;
  if (profile.error) return <div className="p-4 sm:p-6"><ErrorState error={profile.error} /></div>;
  if (profile.data?.onboarding_completed_at) return <Navigate to="/" />;

  const googleEmail = profile.data?.email ?? user?.email ?? '';
  const draftFor = (code: string): LinkDraft => links[code] ?? { enabled: false, email: googleEmail, method: 'google_sso' };
  const setDraft = (code: string, patch: Partial<LinkDraft>) => setLinks({ ...links, [code]: { ...draftFor(code), ...patch } });

  async function finish(withLinks: boolean) {
    try {
      await updateProfile.mutateAsync({
        country_code: country,
        currency,
        retailer_codes: retailerCodes,
        model_id: modelId,
        onboarding_completed_at: new Date().toISOString(),
      });
      const rows = retailerCodes
        .map((code) => ({ code, d: draftFor(code) }))
        .filter(({ d }) => withLinks && d.enabled && d.email.includes('@'))
        .map(({ code, d }) => ({ retailer_code: code, account_email: d.email.trim(), login_method: d.method }));
      if (rows.length) await linkAccounts.mutateAsync(rows);
      await qc.invalidateQueries({ queryKey: ['profile'] });
      navigate({ to: '/' });
    } catch {
      // toasts are raised by the mutations
    }
  }

  const canContinue = [Boolean(country && currency), retailerCodes.length > 0, true, true][step];
  const busy = updateProfile.isPending || linkAccounts.isPending;

  return (
    <main className="min-h-screen bg-muted/30 px-4 py-10">
      <h1 className="mb-6 text-center text-2xl font-semibold">Welcome to Scout</h1>
      <OnboardingStepper
        steps={STEPS}
        current={step}
        canContinue={canContinue}
        busy={busy}
        onBack={() => setStep(Math.max(0, step - 1))}
        onNext={() => (step === STEPS.length - 1 ? finish(true) : setStep(step + 1))}
        onSkip={() => finish(false)}
        finishLabel="Finish setup"
      >
        {step === 0 && (
          <div className="space-y-6">
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">Country</legend>
              <RadioGroup
                value={country}
                onValueChange={(v) => {
                  const c = v as CountryCode;
                  setCountry(c);
                  setCurrency(defaultCurrency(c));
                  setSelected(null); // reset to "all available in the new country"
                }}
              >
                {COUNTRIES.map((c) => (
                  <div key={c.code} className="flex items-center gap-2">
                    <RadioGroupItem value={c.code} id={`country-${c.code}`} />
                    <Label htmlFor={`country-${c.code}`} className="font-normal">
                      {c.name}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
              <p className="text-sm text-muted-foreground">Scout currently serves Kenya, the United States and South Africa.</p>
            </fieldset>
            <div className="max-w-xs space-y-2">
              <Label htmlFor="onboarding-currency">Currency</Label>
              <Select value={currency} onValueChange={(v) => setCurrency(v as CurrencyCode)}>
                <SelectTrigger id="onboarding-currency">
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
        )}

        {step === 1 && (
          <fieldset className="space-y-3">
            <legend className="sr-only">Retailers to search</legend>
            {retailers.isLoading && <p>Loading retailers…</p>}
            {available.length === 0 && !retailers.isLoading && (
              <Alert>
                <AlertTitle>No retailers available</AlertTitle>
                <AlertDescription>No retailers are enabled for this country yet. Go back and choose another country.</AlertDescription>
              </Alert>
            )}
            {available.map((r) => {
              const domain = r.country_domains[country];
              return (
                <div key={r.code} className="flex items-start gap-2">
                  <Checkbox
                    id={`retailer-${r.code}`}
                    checked={retailerCodes.includes(r.code)}
                    onCheckedChange={(v) =>
                      setSelected(v === true ? [...retailerCodes, r.code] : retailerCodes.filter((c) => c !== r.code))
                    }
                  />
                  <Label htmlFor={`retailer-${r.code}`} className="font-normal leading-snug">
                    {r.display_name}
                    <span className="block text-xs text-muted-foreground">
                      {domain === '*' ? 'Independent stores that ship to you' : domain}
                      {r.cross_border_countries.includes(country) ? ' · ships internationally, import duties may apply' : ''}
                    </span>
                  </Label>
                </div>
              );
            })}
            {retailerCodes.length === 0 && available.length > 0 && (
              <p role="alert" className="text-sm text-destructive">
                Choose at least one retailer.
              </p>
            )}
          </fieldset>
        )}

        {step === 2 && (
          <fieldset className="space-y-3">
            <legend className="sr-only">Default AI model</legend>
            {platformModels.length === 0 ? (
              <Alert>
                <AlertTitle>No AI models are enabled yet</AlertTitle>
                <AlertDescription>An admin needs to enable a model before searches can run. You can finish setup now.</AlertDescription>
              </Alert>
            ) : (
              <RadioGroup value={modelId ?? undefined} onValueChange={setModelId}>
                {platformModels.map((m) => (
                  <div key={m.id} className="flex items-start gap-2 rounded-md border p-3">
                    <RadioGroupItem value={m.id} id={`model-${m.id}`} className="mt-0.5" />
                    <Label htmlFor={`model-${m.id}`} className="font-normal leading-snug">
                      <span className="font-medium">{m.display_name}</span>
                      {m.is_default && <span className="text-muted-foreground"> (recommended)</span>}
                      {m.description && <span className="block text-sm text-muted-foreground">{m.description}</span>}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            )}
            <p className="text-sm text-muted-foreground">You can choose a different model for each wishlist.</p>
          </fieldset>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <Alert>
              <AlertTitle>Linking is informational for now</AlertTitle>
              <AlertDescription>
                We record which account you use at each store so we can help you add items or check out there later. We never ask
                for retailer passwords, and signing in to Scout with Google doesn't give us access to your store accounts.
              </AlertDescription>
            </Alert>
            {retailerCodes.map((code) => {
              const r = available.find((x) => x.code === code);
              const d = draftFor(code);
              return (
                <fieldset key={code} className="space-y-2 rounded-md border p-3">
                  <legend className="sr-only">{r?.display_name ?? code}</legend>
                  <div className="flex items-center gap-2">
                    <Checkbox id={`link-${code}`} checked={d.enabled} onCheckedChange={(v) => setDraft(code, { enabled: v === true })} />
                    <Label htmlFor={`link-${code}`}>Link my {r?.display_name ?? code} account</Label>
                  </div>
                  {d.enabled && (
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label htmlFor={`link-email-${code}`}>Account email</Label>
                        <Input id={`link-email-${code}`} type="email" value={d.email} onChange={(e) => setDraft(code, { email: e.target.value })} />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`link-method-${code}`}>How you sign in there</Label>
                        <Select value={d.method} onValueChange={(v) => setDraft(code, { method: v as LinkDraft['method'] })}>
                          <SelectTrigger id={`link-method-${code}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="google_sso">Sign in with Google</SelectItem>
                            <SelectItem value="email">Email and password</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}
                </fieldset>
              );
            })}
          </div>
        )}
      </OnboardingStepper>
    </main>
  );
}
