/**
 * Sign-in. Google OAuth is the only production sign-in method (FR-0a).
 * The email/password form is a local-development convenience, rendered only
 * when VITE_ENABLE_DEV_LOGIN=true; production must also keep email sign-in
 * disabled in Supabase Auth.
 */
import { useState, type FormEvent } from 'react';
import { createFileRoute, Navigate } from '@tanstack/react-router';
import { ShoppingBag } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { FullPageSpinner } from '@/components/app/PageState';
import { supabase } from '@/data/supabase';
import { useAuth } from '@/hooks/useAuth';
import { errorMessage, toastError } from '@/lib/errors';

export const Route = createFileRoute('/login')({
  component: LoginPage,
});

const DEV_LOGIN = import.meta.env.VITE_ENABLE_DEV_LOGIN === 'true';

function LoginPage() {
  const { session, isLoading, signInWithGoogle } = useAuth();
  const [busy, setBusy] = useState(false);

  if (isLoading) return <FullPageSpinner />;
  if (session) return <Navigate to="/" />;

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <ShoppingBag className="h-10 w-10 text-primary" aria-hidden />
          <CardTitle>
            <h1>Scout</h1>
          </CardTitle>
          <CardDescription>
            Describe what you want once. Scout searches Takealot, Amazon, Temu, Jumia and independent stores for you.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            className="w-full"
            size="lg"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await signInWithGoogle();
              } catch (e) {
                toastError(e, 'Google sign-in failed');
                setBusy(false);
              }
            }}
          >
            <GoogleMark /> Continue with Google
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            We only ask Google for your name, email and profile picture.
          </p>
          {DEV_LOGIN && (
            <>
              <Separator />
              <DevLoginForm />
            </>
          )}
        </CardContent>
        <CardFooter>
          <p className="text-xs text-muted-foreground">Launching in Kenya, the United States and South Africa.</p>
        </CardFooter>
      </Card>
    </main>
  );
}

function DevLoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent, mode: 'signin' | 'signup') {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } =
      mode === 'signin'
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
    if (err) setError(errorMessage(err));
    setBusy(false);
  }

  return (
    <form className="space-y-3" onSubmit={(e) => submit(e, 'signin')} aria-labelledby="dev-login-title">
      <Alert>
        <AlertTitle id="dev-login-title">Development sign-in</AlertTitle>
        <AlertDescription>Local testing only (VITE_ENABLE_DEV_LOGIN). Not available in production.</AlertDescription>
      </Alert>
      <div className="space-y-1">
        <Label htmlFor="dev-email">Email</Label>
        <Input id="dev-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div className="space-y-1">
        <Label htmlFor="dev-password">Password</Label>
        <Input id="dev-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="secondary" className="flex-1" disabled={busy}>
          Sign in
        </Button>
        <Button type="button" variant="outline" className="flex-1" disabled={busy} onClick={(e) => submit(e as unknown as FormEvent, 'signup')}>
          Create account
        </Button>
      </div>
    </form>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4">
      <path fill="currentColor" d="M21.35 11.1h-9.17v2.73h6.51c-.33 3.81-3.5 5.44-6.5 5.44C8.36 19.27 5 16.25 5 12c0-4.1 3.2-7.27 7.2-7.27 3.09 0 4.9 1.97 4.9 1.97L19 4.72S16.56 2 12.1 2C6.42 2 2.03 6.8 2.03 12c0 5.05 4.13 10 10.22 10 5.35 0 9.25-3.67 9.25-9.09 0-1.15-.15-1.81-.15-1.81Z" />
    </svg>
  );
}
