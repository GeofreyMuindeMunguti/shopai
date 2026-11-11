/**
 * Admin ▸ AI Models: curate Bedrock models, run test invocations, pick the default.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { CheckCircle2, Loader2, MoreHorizontal, Plus, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { AdminDataTable } from '@/components/app/AdminDataTable';
import { AdminPageHeader } from '@/components/app/AdminLayout';
import { ErrorState } from '@/components/app/PageState';
import {
  useAdminModels,
  useDeleteModel,
  useModelTestJobs,
  useRequestModelTest,
  useSaveModel,
  useSetDefaultModel,
  type LlmModelInput,
} from '@/data/admin';
import type { LlmModel } from '@/data/types';
import { timeAgo } from '@/lib/format';

export const Route = createFileRoute('/_app/admin/models')({
  component: ModelsPage,
});

function ModelsPage() {
  const [pending, setPending] = useState(true);
  const models = useAdminModels(pending);
  const jobs = useModelTestJobs(pending);
  const save = useSaveModel();
  const remove = useDeleteModel();
  const setDefault = useSetDefaultModel();
  const test = useRequestModelTest();
  const [editing, setEditing] = useState<LlmModel | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  // A test is pending while a model_test job is newer than the model's last result.
  const pendingIds = useMemo(() => {
    const ids = new Set<string>();
    for (const j of jobs.data ?? []) {
      if (j.status === 'failed' || j.status === 'cancelled') continue;
      const id = String(j.payload?.model_id ?? '');
      const m = models.data?.find((x) => x.id === id);
      if (m && (!m.last_test_at || new Date(j.created_at) > new Date(m.last_test_at))) ids.add(id);
    }
    return ids;
  }, [jobs.data, models.data]);

  useEffect(() => setPending(pendingIds.size > 0), [pendingIds]);

  const defaultId = models.data?.find((m) => m.is_default)?.id ?? '';

  const columns = useMemo<ColumnDef<LlmModel>[]>(
    () => [
      {
        accessorKey: 'display_name',
        header: 'Name',
        cell: ({ row }) => (
          <div>
            <div className="font-medium">{row.original.display_name}</div>
            {row.original.description && <div className="text-xs text-muted-foreground">{row.original.description}</div>}
          </div>
        ),
      },
      { accessorKey: 'bedrock_model_id', header: 'Bedrock ID', cell: ({ getValue }) => <code className="text-xs">{String(getValue())}</code> },
      {
        id: 'enabled',
        header: 'Enabled',
        cell: ({ row }) => {
          const m = row.original;
          const canEnable = m.last_test_ok === true;
          return (
            <Switch
              checked={m.is_enabled}
              disabled={save.isPending || m.is_default || (!m.is_enabled && !canEnable)}
              onCheckedChange={(v) => save.mutate({ id: m.id, is_enabled: v })}
              aria-label={`${m.is_enabled ? 'Disable' : 'Enable'} ${m.display_name}${!canEnable && !m.is_enabled ? ' (needs a passing test)' : ''}`}
            />
          );
        },
      },
      {
        id: 'default',
        header: 'Default',
        cell: ({ row }) => (
          <RadioGroupItem
            value={row.original.id}
            disabled={!row.original.is_enabled}
            aria-label={`Make ${row.original.display_name} the default`}
          />
        ),
      },
      { accessorKey: 'max_output_tokens', header: 'Max output tokens' },
      { accessorKey: 'cost_note', header: 'Cost note', cell: ({ getValue }) => (getValue() as string) || '—' },
      {
        id: 'test',
        header: 'Last test',
        cell: ({ row }) => {
          const m = row.original;
          if (pendingIds.has(m.id))
            return (
              <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Testing…
              </span>
            );
          if (m.last_test_ok === null) return <span className="text-sm text-muted-foreground">Not tested</span>;
          return (
            <span className="space-y-0.5">
              <Badge variant="outline" className={m.last_test_ok ? 'gap-1 text-success' : 'gap-1 text-destructive'}>
                {m.last_test_ok ? <CheckCircle2 className="h-3 w-3" aria-hidden /> : <XCircle className="h-3 w-3" aria-hidden />}
                {m.last_test_ok ? 'Passed' : 'Failed'}
              </Badge>
              <span className="block text-xs text-muted-foreground">{timeAgo(m.last_test_at)}</span>
              {m.last_test_error && <span className="block max-w-xs text-xs text-destructive">{m.last_test_error}</span>}
            </span>
          );
        },
      },
      {
        id: 'actions',
        header: () => <span className="sr-only">Actions</span>,
        cell: ({ row }) => {
          const m = row.original;
          return (
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline" disabled={pendingIds.has(m.id)} onClick={() => test.mutate(m.id, { onSuccess: () => setPending(true) })}>
                Test
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon" variant="ghost" aria-label={`More actions for ${m.display_name}`}>
                    <MoreHorizontal aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() => {
                      setEditing(m);
                      setFormOpen(true);
                    }}
                  >
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={m.is_default}
                    className="text-destructive"
                    onSelect={() => window.confirm(`Delete ${m.display_name}? Wishlists using it fall back to the default.`) && remove.mutate(m.id)}
                  >
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      },
    ],
    [pendingIds, save, test, remove]
  );

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="AI models"
        description="Bedrock models users can choose. New or changed models are tested automatically (including a tool-use round trip) and can only be enabled after a passing test."
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus aria-hidden /> Add model
          </Button>
        }
      />
      {models.error && <ErrorState error={models.error} />}
      <RadioGroup value={defaultId} onValueChange={(id) => setDefault.mutate(id)} aria-label="Default model" className="block">
        <AdminDataTable columns={columns} data={models.data} isLoading={models.isLoading} caption="AI models" emptyMessage="No models yet. Add one to get started." />
      </RadioGroup>
      <p className="text-sm text-muted-foreground">
        Disabling a model moves its users to their default or the platform default; they're notified at their next sign-in. The default model can't be disabled — choose another default first.
      </p>
      <ModelFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        model={editing}
        busy={save.isPending}
        onSubmit={(input) =>
          save.mutate(editing ? { id: editing.id, ...input } : input, {
            onSuccess: () => {
              setFormOpen(false);
              setPending(true);
            },
          })
        }
      />
    </div>
  );
}

function ModelFormDialog({
  open,
  onOpenChange,
  model,
  busy,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  model: LlmModel | null;
  busy: boolean;
  onSubmit: (input: LlmModelInput) => void;
}) {
  const [form, setForm] = useState<LlmModelInput>({
    display_name: '',
    description: '',
    bedrock_model_id: '',
    supports_tools: true,
    max_output_tokens: 4096,
    supports_images: false,
    cost_note: '',
  });
  useEffect(() => {
    if (!open) return;
    setForm({
      display_name: model?.display_name ?? '',
      description: model?.description ?? '',
      bedrock_model_id: model?.bedrock_model_id ?? '',
      supports_tools: model?.supports_tools ?? true,
      max_output_tokens: model?.max_output_tokens ?? 4096,
      supports_images: model?.supports_images ?? false,
      cost_note: model?.cost_note ?? '',
    });
  }, [open, model]);

  const set = <K extends keyof LlmModelInput>(k: K, v: LlmModelInput[K]) => setForm({ ...form, [k]: v });

  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit({ ...form, description: form.description || null, cost_note: form.cost_note || null });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>{model ? 'Edit model' : 'Add model'}</DialogTitle>
            <DialogDescription>Saving runs a test invocation against BEDROCK_ENDPOINT_URL. Changing the Bedrock ID disables the model until it passes again.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="model-name">Display name</Label>
            <Input id="model-name" value={form.display_name} onChange={(e) => set('display_name', e.target.value)} required placeholder="Fast & economical" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="model-desc">Description shown to users</Label>
            <Textarea id="model-desc" value={form.description ?? ''} onChange={(e) => set('description', e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="model-ref">Bedrock model / inference-profile ID</Label>
            <Input id="model-ref" value={form.bedrock_model_id} onChange={(e) => set('bedrock_model_id', e.target.value)} required className="font-mono" />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="model-max">Max output tokens</Label>
              <Input id="model-max" type="number" min={1} value={form.max_output_tokens} onChange={(e) => set('max_output_tokens', Number(e.target.value))} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="model-cost">Cost note</Label>
              <Input id="model-cost" value={form.cost_note ?? ''} onChange={(e) => set('cost_note', e.target.value)} />
            </div>
          </div>
          <div className="flex flex-wrap gap-6">
            <div className="flex items-center gap-2">
              <Switch id="model-tools" checked={form.supports_tools} onCheckedChange={(v) => set('supports_tools', v)} />
              <Label htmlFor="model-tools" className="font-normal">Supports tool use (required)</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="model-images" checked={form.supports_images} onCheckedChange={(v) => set('supports_images', v)} />
              <Label htmlFor="model-images" className="font-normal">Supports images</Label>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !form.display_name.trim() || !form.bedrock_model_id.trim()}>
              Save & test
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
