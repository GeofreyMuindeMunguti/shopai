/**
 * My Wishlists
 */
import { useState } from 'react';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Heart, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState, ErrorState } from '@/components/app/PageState';
import { WishlistFormDialog } from '@/components/app/WishlistFormDialog';
import { useAvailableModels, useProfile, useQuota, useSaveWishlist, useWishlists } from '@/data/queries';

export const Route = createFileRoute('/_app/')({
  component: WishlistsPage,
});

function WishlistsPage() {
  const wishlists = useWishlists();
  const models = useAvailableModels();
  const { data: profile } = useProfile();
  const quota = useQuota();
  const save = useSaveWishlist();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const modelName = (id: string | null) => models.data?.find((m) => m.id === id)?.display_name;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">My Wishlists</h1>
          {quota.data && (
            <p className="text-sm text-muted-foreground">
              {quota.data.enabled
                ? `${quota.data.used} of ${quota.data.cap} searches used today`
                : 'Searching is paused by the Scout team right now.'}
            </p>
          )}
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus aria-hidden /> New wishlist
        </Button>
      </div>

      {wishlists.error && <ErrorState error={wishlists.error} />}
      {wishlists.isLoading && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      )}

      {wishlists.data && wishlists.data.length === 0 && (
        <EmptyState icon={<Heart className="h-10 w-10 text-muted-foreground" aria-hidden />} title="Start your first wishlist">
          <p className="max-w-md text-sm text-muted-foreground">
            Group the things you're shopping for — "Home office", "Birthday gifts", "Hiking trip" — and Scout will search your
            retailers for each item.
          </p>
          <Button onClick={() => setOpen(true)}>
            <Plus aria-hidden /> New wishlist
          </Button>
        </EmptyState>
      )}

      {wishlists.data && wishlists.data.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {wishlists.data.map((w) => (
            <li key={w.id}>
              <Link
                to="/wishlists/$wishlistId"
                params={{ wishlistId: w.id }}
                className="block h-full rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Card className="h-full transition-colors hover:bg-muted/40">
                  <CardHeader>
                    <CardTitle className="text-lg">
                      <h2>{w.name}</h2>
                    </CardTitle>
                    <CardDescription>
                      {w.wishlist_items?.[0]?.count ?? 0} items
                      {modelName(w.model_id) ? ` · ${modelName(w.model_id)}` : ''}
                    </CardDescription>
                    {w.description && <p className="line-clamp-2 text-sm">{w.description}</p>}
                  </CardHeader>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <WishlistFormDialog
        open={open}
        onOpenChange={setOpen}
        models={models.data ?? []}
        defaultModelId={profile?.model_id ?? null}
        defaults={{ currency: profile?.currency ?? 'USD', country: profile?.country_code ?? null }}
        busy={save.isPending}
        onSubmit={async (input) => {
          const w = await save.mutateAsync(input).catch(() => null);
          if (w) {
            setOpen(false);
            navigate({ to: '/wishlists/$wishlistId', params: { wishlistId: w.id } });
          }
        }}
      />
    </div>
  );
}
