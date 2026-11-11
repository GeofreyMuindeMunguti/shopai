/**
 * Admin ▸ Background-task models (FR-1d). null = "Use wishlist model".
 */
import { createFileRoute } from '@tanstack/react-router';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { AdminPageHeader } from '@/components/app/AdminLayout';
import { ErrorState } from '@/components/app/PageState';
import { useAdminModels, useSaveTaskModel, useTaskModels } from '@/data/admin';
import { TASK_LABELS } from '@/lib/markets';

export const Route = createFileRoute('/_app/admin/tasks')({
  component: TasksPage,
});

const WISHLIST = '__wishlist';

const TASK_HINTS: Record<string, string> = {
  category_inference: 'Maps the item to the product taxonomy for store discovery. A small, fast model is usually enough.',
  discovery_queries: 'Writes Shopify store-discovery search queries.',
  attribute_extraction: 'Extracts size, colour and specs when structured data is missing. Never price, URL or availability.',
  preference_summary: 'Condenses approve/reject history into prompt preferences.',
  cross_retailer_rerank: 'Final ranking and dedupe tie-breaks when merging retailers.',
};

function TasksPage() {
  const tasks = useTaskModels();
  const models = useAdminModels(false);
  const save = useSaveTaskModel();
  const enabled = (models.data ?? []).filter((m) => m.is_enabled);

  return (
    <div className="space-y-6">
      <AdminPageHeader title="Background-task models" description="Send smaller LLM calls to cheaper or faster models. The main scout loop always uses the wishlist's model." />
      <Alert>
        <AlertDescription>These mappings are ignored for bring-your-own-model wishlists, which use the user's own model for every call.</AlertDescription>
      </Alert>
      {tasks.error && <ErrorState error={tasks.error} />}
      <Card>
        <CardContent className="divide-y p-0">
          {tasks.isLoading && <Skeleton className="m-4 h-24" />}
          {(tasks.data ?? []).map((t) => {
            const id = `task-${t.task_key}`;
            const current = t.model_id && enabled.some((m) => m.id === t.model_id) ? t.model_id : WISHLIST;
            return (
              <div key={t.task_key} className="grid gap-2 p-4 sm:grid-cols-[1fr_18rem] sm:items-center">
                <div>
                  <Label htmlFor={id} className="text-sm font-medium">
                    {TASK_LABELS[t.task_key] ?? t.task_key}
                  </Label>
                  <p className="text-sm text-muted-foreground">{TASK_HINTS[t.task_key]}</p>
                  {t.model_id && current === WISHLIST && <p className="text-sm text-warning">The mapped model is disabled; the wishlist model is used.</p>}
                </div>
                <Select value={current} onValueChange={(v) => save.mutate({ taskKey: t.task_key, modelId: v === WISHLIST ? null : v })} disabled={save.isPending}>
                  <SelectTrigger id={id}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={WISHLIST}>Use wishlist model</SelectItem>
                    {enabled.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.display_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
