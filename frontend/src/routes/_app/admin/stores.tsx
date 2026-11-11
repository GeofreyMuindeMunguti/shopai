/**
 * Admin ▸ Shopify stores: review discovered stores, block, or pin as seed.
 */
import { useMemo, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { MoreHorizontal } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AdminDataTable } from '@/components/app/AdminDataTable';
import { AdminPageHeader } from '@/components/app/AdminLayout';
import { ErrorState } from '@/components/app/PageState';
import { useSetStoreStatus, useShopifyStores, type StoreFilters } from '@/data/admin';
import type { ShopifyStore } from '@/data/types';
import { timeAgo } from '@/lib/format';
import { COUNTRIES } from '@/lib/markets';

export const Route = createFileRoute('/_app/admin/stores')({
  component: StoresPage,
});

function StoresPage() {
  const [filters, setFilters] = useState<StoreFilters>({ status: 'all', country: 'all', category: '' });
  const stores = useShopifyStores(filters);
  const setStatus = useSetStoreStatus();

  const columns = useMemo<ColumnDef<ShopifyStore>[]>(
    () => [
      {
        accessorKey: 'domain',
        header: 'Store',
        cell: ({ row }) => (
          <div>
            <a href={`https://${row.original.domain}`} target="_blank" rel="noopener noreferrer nofollow" className="font-medium text-primary underline-offset-4 hover:underline">
              {row.original.domain}
            </a>
            {row.original.display_name && <div className="text-xs text-muted-foreground">{row.original.display_name}</div>}
          </div>
        ),
      },
      {
        accessorKey: 'status',
        header: 'Status',
        cell: ({ getValue }) => {
          const s = getValue() as string;
          return <Badge variant={s === 'blocked' ? 'destructive' : s === 'seed' ? 'default' : 'secondary'}>{s}</Badge>;
        },
      },
      { accessorKey: 'quality_score', header: 'Quality', cell: ({ getValue }) => (getValue() == null ? '—' : Number(getValue()).toFixed(2)) },
      { accessorKey: 'ships_to', header: 'Ships to', cell: ({ getValue }) => (getValue() as string[]).join(', ') || '—' },
      { accessorKey: 'currency', header: 'Currency', cell: ({ getValue }) => (getValue() as string) || '—' },
      {
        accessorKey: 'categories',
        header: 'Categories',
        enableSorting: false,
        cell: ({ getValue }) => <span className="text-xs">{(getValue() as string[]).join('; ') || '—'}</span>,
      },
      { accessorKey: 'last_checked_at', header: 'Last checked', cell: ({ getValue }) => timeAgo(getValue() as string | null) },
      {
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => {
          const s = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon" variant="ghost" aria-label={`Actions for ${s.domain}`}>
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={s.status === 'seed'} onSelect={() => setStatus.mutate({ id: s.id, status: 'seed' })}>
                  Pin as seed (checked first)
                </DropdownMenuItem>
                <DropdownMenuItem disabled={s.status === 'discovered'} onSelect={() => setStatus.mutate({ id: s.id, status: 'discovered' })}>
                  Mark as discovered
                </DropdownMenuItem>
                <DropdownMenuItem disabled={s.status === 'blocked'} className="text-destructive" onSelect={() => setStatus.mutate({ id: s.id, status: 'blocked' })}>
                  Block (never used again)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      },
    ],
    [setStatus]
  );

  return (
    <div className="space-y-6">
      <AdminPageHeader title="Shopify stores" description="Stores found by the discovery agent and passed by the quality gate. Shared across all users." />
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-full space-y-1 sm:w-auto">
          <Label htmlFor="store-status">Status</Label>
          <Select value={filters.status} onValueChange={(status) => setFilters({ ...filters, status })}>
            <SelectTrigger id="store-status" className="w-full sm:w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="discovered">Discovered</SelectItem>
              <SelectItem value="seed">Seed</SelectItem>
              <SelectItem value="blocked">Blocked</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-full space-y-1 sm:w-auto">
          <Label htmlFor="store-country">Ships to</Label>
          <Select value={filters.country} onValueChange={(country) => setFilters({ ...filters, country })}>
            <SelectTrigger id="store-country" className="w-full sm:w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any country</SelectItem>
              {COUNTRIES.map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-full space-y-1 sm:w-auto">
          <Label htmlFor="store-category">Category (exact taxonomy path)</Label>
          <Input id="store-category" className="w-full sm:w-72" value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })} placeholder="Apparel & Accessories > Shoes" />
        </div>
      </div>
      {stores.error && <ErrorState error={stores.error} />}
      <AdminDataTable columns={columns} data={stores.data} isLoading={stores.isLoading} caption="Shopify stores" emptyMessage="No stores match these filters." />
    </div>
  );
}
