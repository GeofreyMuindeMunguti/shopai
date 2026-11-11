/**
 * OAuth redirect target. supabase-js (detectSessionInUrl + PKCE) exchanges the
 * `?code=` for a session on load; we just wait for it and move on.
 */
import { useEffect, useState } from 'react';
import { createFileRoute, Link, Navigate } from '@tanstack/react-router';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { FullPageSpinner } from '@/components/app/PageState';
import { useAuth } from '@/hooks/useAuth';

export const Route = createFileRoute('/auth/callback')({
  component: AuthCallback,
});

function AuthCallback() {
  const { session } = useAuth();
  const [timedOut, setTimedOut] = useState(false);
  const params = new URLSearchParams(window.location.search);
  const error = params.get('error_description') || params.get('error');

  useEffect(() => {
    const t = window.setTimeout(() => setTimedOut(true), 10_000);
    return () => window.clearTimeout(t);
  }, []);

  if (session) return <Navigate to="/" />;
  if (error || timedOut) {
    return (
      <main className="mx-auto max-w-md p-6">
        <Alert variant="destructive">
          <AlertTitle>Sign-in didn't complete</AlertTitle>
          <AlertDescription>
            {error ?? 'We could not confirm your Google sign-in.'}{' '}
            <Link to="/login" className="underline">
              Try again
            </Link>
          </AlertDescription>
        </Alert>
      </main>
    );
  }
  return <FullPageSpinner label="Signing you in…" />;
}
