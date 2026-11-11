/**
 * Wishlist detail: items, live scouting progress, candidate review.
 */
import { useMemo, useState } from 'react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { toast } from 'sonner';
import { ArrowLeft, Bot, Pencil, Plus, Sparkles } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { ItemFormDialog, searchFieldsChanged } from '@/components/app/ItemFormDialog';
import { ItemPanel } from '@/components/app/ItemPanel';
import { EmptyState, ErrorState, FullPageSpinner } from '@/components/app/PageState';
import { WishlistFormDialog } from '@/components/app/WishlistFormDialog';
import {
  useAvailableModels,
  useCreateItem,
  useDecideMatch,
  useFx,
  useItems,
  useMatches,
  useProfile,
  useRequestScout,
  useResolvedModel,
  useRetailers,
  useRuns,
  useSaveWishlist,
  useUpdateItem,
  useWishlist,
} from '@/data/queries';
import type { ProductMatch, ScoutRun, WishlistItem } from '@/data/types';
import { useAuth } from '@/hooks/useAuth';
import { useWishlistRealtime } from '@/hooks/useRealtime';
import { FX_ATTRIBUTION } from '@/lib/fx';

export const Route = createFileRoute('/_app/wishlists/$wishlistId')({
  component: WishlistPage,
});

const EXAMPLES = [
  'Noise-cancelling over-ear headphones, under $250, black',
  'Waterproof hiking boots, size 10',
  'Ergonomic office chair with lumbar support',
];

function groupBy<T>(rows: T[] | undefined, key: (r: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const r of rows ?? []) (out[key(r)] ??= []).push(r);
  return out;
}

function WishlistPage() {
  const { wishlistId } = Route.useParams();
  const { user } = useAuth();
  useWishlistRealtime(wishlistId, user?.id);

  const wishlist = useWishlist(wishlistId);
  const items = useItems(wishlistId);
  const matches = useMatches(wishlistId);
  const runs = useRuns(wishlistId);
  const retailers = useRetailers();
  const models = useAvailableModels();
  const resolved = useResolvedModel(wishlistId);
  const fx = useFx();
  const { data: profile } = useProfile();

  const createItem = useCreateItem(wishlistId);
  const updateItem = useUpdateItem();
  const scout = useRequestScout();
  const decide = useDecideMatch();
  const saveWishlist = useSaveWishlist();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<WishlistItem | null>(null);
  const [prefill, setPrefill] = useState<string | undefined>();
  const [rescoutItem, setRescoutItem] = useState<WishlistItem | null>(null);
  const [editWishlist, setEditWishlist] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const retailerNames = useMemo(
    () => Object.fromEntries((retailers.data ?? []).map((r) => [r.code, r.display_name.replace(' (Shopify)', '')])),
    [retailers.data]
  );
  const matchesByItem = useMemo(() => groupBy<ProductMatch>(matches.data, (m) => m.wishlist_item_id), [matches.data]);
  const runsByItem = useMemo(() => groupBy<ScoutRun>(runs.data, (r) => r.wishlist_item_id), [runs.data]);

  if (wishlist.isLoading) return <FullPageSpinner />;
  if (wishlist.error || !wishlist.data) return <div className="p-4 sm:p-6"><ErrorState error={wishlist.error ?? 'Wishlist not found'} /></div>;

  const w = wishlist.data;
  const displayCurrency = profile?.currency ?? w.default_currency;
  const allItems = items.data ?? [];
  const activeItems = allItems.filter((i) => i.status !== 'archived');
  const archivedItems = allItems.filter((i) => i.status === 'archived');
  const shownItems = showArchived ? [...activeItems, ...archivedItems] : activeItems;
  const busy = decide.isPending || scout.isPending || updateItem.isPending;
  const hasConversions = (matches.data ?? []).some((m) => m.currency && m.currency !== displayCurrency);

  const openAdd = (title?: string) => {
    setEditing(null);
    setPrefill(title);
    setFormOpen(true);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" aria-hidden /> My Wishlists
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="break-words text-2xl font-semibold">{w.name}</h1>
          {w.description && <p className="break-words text-muted-foreground">{w.description}</p>}
          {resolved.data?.display_name && (
            <Badge variant="outline" className="gap-1">
              <Bot className="h-3 w-3" aria-hidden /> {resolved.data.display_name}
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setEditWishlist(true)}>
            <Pencil aria-hidden /> Edit wishlist
          </Button>
          <Button onClick={() => openAdd()}>
            <Plus aria-hidden /> Add item
          </Button>
        </div>
      </div>

      {resolved.data?.fallback_reason && (
        <Alert>
          <AlertTitle>Model unavailable</AlertTitle>
          <AlertDescription>{resolved.data.fallback_reason}. Edit the wishlist to pick another model.</AlertDescription>
        </Alert>
      )}

      {(items.isLoading || matches.isLoading) && <Skeleton className="h-24 w-full" />}
      {items.error && <ErrorState error={items.error} />}

      {items.data && activeItems.length === 0 && (
        <EmptyState icon={<Sparkles className="h-10 w-10 text-muted-foreground" aria-hidden />} title="Add your first item">
          <p className="max-w-md text-sm text-muted-foreground">
            Describe it in your own words. Scout searches every retailer you picked at once and shows verified matches side by side.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {EXAMPLES.map((ex) => (
              <Button key={ex} variant="outline" size="sm" onClick={() => openAdd(ex)}>
                {ex}
              </Button>
            ))}
          </div>
        </EmptyState>
      )}

      <div className="space-y-3">
        {shownItems.map((item, idx) => (
          <ItemPanel
            key={item.id}
            item={item}
            matches={matchesByItem[item.id] ?? []}
            runs={runsByItem[item.id] ?? []}
            retailerNames={retailerNames}
            displayCurrency={displayCurrency}
            fx={fx.data}
            defaultOpen={idx === 0}
            busy={busy}
            onDecide={(m, decision, reason) =>
              decide.mutate(
                { matchId: m.id, decision, reason },
                { onSuccess: () => decision === 'approve' && toast.success('Chosen', { description: m.title }) }
              )
            }
            onFindMore={() => scout.mutate({ itemId: item.id, reason: 'manual' })}
            onEdit={() => {
              setEditing(item);
              setPrefill(undefined);
              setFormOpen(true);
            }}
            onArchiveToggle={() => updateItem.mutate({ id: item.id, status: item.status === 'archived' ? 'draft' : 'archived' })}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        {archivedItems.length > 0 ? (
          <div className="flex items-center gap-2">
            <Switch id="show-archived" checked={showArchived} onCheckedChange={setShowArchived} />
            <Label htmlFor="show-archived" className="font-normal">Show {archivedItems.length} archived</Label>
          </div>
        ) : (
          <span />
        )}
        {hasConversions && <p className="text-xs text-muted-foreground">Converted prices are approximate. {FX_ATTRIBUTION}.</p>}
      </div>

      <ItemFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        item={editing}
        prefillTitle={prefill}
        retailers={retailers.data ?? []}
        profileRetailers={profile?.retailer_codes ?? []}
        defaultCurrency={displayCurrency}
        defaultCountry={w.ship_to_country ?? profile?.country_code ?? null}
        busy={createItem.isPending || updateItem.isPending}
        onSubmit={async (input) => {
          if (editing) {
            const changed = searchFieldsChanged(editing, input);
            const saved = await updateItem.mutateAsync({ id: editing.id, ...input }).catch(() => null);
            if (!saved) return;
            setFormOpen(false);
            if (changed) setRescoutItem(saved);
          } else {
            const created = await createItem.mutateAsync(input).catch(() => null);
            if (created) setFormOpen(false);
          }
        }}
      />

      <AlertDialog open={Boolean(rescoutItem)} onOpenChange={(o) => !o && setRescoutItem(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Search again with the new details?</AlertDialogTitle>
            <AlertDialogDescription>
              Existing matches stay visible but are marked as possibly outdated.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not now</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (rescoutItem) scout.mutate({ itemId: rescoutItem.id, reason: 'constraints_changed' });
                setRescoutItem(null);
              }}
            >
              Search again
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <WishlistFormDialog
        open={editWishlist}
        onOpenChange={setEditWishlist}
        wishlist={w}
        models={models.data ?? []}
        defaultModelId={profile?.model_id ?? null}
        defaults={{ currency: displayCurrency, country: w.ship_to_country }}
        busy={saveWishlist.isPending}
        onSubmit={async (input) => {
          const ok = await saveWishlist.mutateAsync({ id: w.id, ...input }).catch(() => null);
          if (ok) setEditWishlist(false);
        }}
      />
    </div>
  );
}
