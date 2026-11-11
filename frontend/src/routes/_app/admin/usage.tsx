/**
 * Admin ▸ Usage: runs, tokens and failures by model, retailer and background task.
 */
import { createFileRoute } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AdminDataTable } from '@/components/app/AdminDataTable';
import { AdminPageHeader } from '@/components/app/AdminLayout';
import { useAdminView } from '@/data/admin';
import { formatNumber } from '@/lib/format';
import { TASK_LABELS } from '@/lib/markets';

export const Route = createFileRoute('/_app/admin/usage')({
  component: UsagePage,
});

interface ModelUsage {
  day: string;
  model_name: string;
  runs: number;
  completed: number;
  partial: number;
  no_matches: number;
  failed: number;
  input_tokens: number;
  output_tokens: number;
  pages_fetched: number;
  avg_duration_s: number | null;
}
interface RetailerUsage {
  day: string;
  retailer_code: string;
  model_name: string;
  runs: number;
  completed: number;
  no_matches: number;
  failed: number;
  matches: number;
  input_tokens: number;
  output_tokens: number;
}
interface TaskUsage {
  day: string;
  task_key: string;
  model_ref: string | null;
  runs: number;
  input_tokens: number;
  output_tokens: number;
}

function num<T>(key: keyof T & string, header: string): ColumnDef<T, any> {
  return {
    id: key,
    header,
    accessorFn: (row: T) => row[key],
    cell: ({ getValue }) => <span className="tabular-nums">{formatNumber(getValue() as number)}</span>,
  };
}
const failureRate = (r: { runs: number; failed: number }) => (r.runs ? `${Math.round((r.failed / r.runs) * 100)}%` : '—');

const modelColumns: ColumnDef<ModelUsage, any>[] = [
  { accessorKey: 'day', header: 'Day' },
  { accessorKey: 'model_name', header: 'Model' },
  num('runs', 'Runs'),
  num('completed', 'Completed'),
  num('partial', 'Partial'),
  num('no_matches', 'No matches'),
  { id: 'failure', header: 'Failure rate', accessorFn: failureRate },
  num('input_tokens', 'Input tokens'),
  num('output_tokens', 'Output tokens'),
  num('pages_fetched', 'Pages fetched'),
  { accessorKey: 'avg_duration_s', header: 'Avg duration (s)' },
];

const retailerColumns: ColumnDef<RetailerUsage, any>[] = [
  { accessorKey: 'day', header: 'Day' },
  { accessorKey: 'retailer_code', header: 'Retailer' },
  { accessorKey: 'model_name', header: 'Model' },
  num('runs', 'Runs'),
  num('matches', 'Matches'),
  num('no_matches', 'No matches'),
  { id: 'failure', header: 'Failure rate', accessorFn: failureRate },
  num('input_tokens', 'Input tokens'),
  num('output_tokens', 'Output tokens'),
];

const taskColumns: ColumnDef<TaskUsage, any>[] = [
  { accessorKey: 'day', header: 'Day' },
  { accessorKey: 'task_key', header: 'Task', cell: ({ getValue }) => TASK_LABELS[getValue() as string] ?? (getValue() === 'scout_agent' ? 'Scout agent (main loop)' : getValue()) },
  { accessorKey: 'model_ref', header: 'Model ref', cell: ({ getValue }) => <code className="text-xs">{(getValue() as string) ?? '—'}</code> },
  num('runs', 'Runs'),
  num('input_tokens', 'Input tokens'),
  num('output_tokens', 'Output tokens'),
];

function UsagePage() {
  const byModel = useAdminView<ModelUsage>('admin_usage_summary');
  const byRetailer = useAdminView<RetailerUsage>('admin_retailer_usage');
  const byTask = useAdminView<TaskUsage>('admin_task_usage');
  return (
    <div className="space-y-6">
      <AdminPageHeader title="Usage" description="Per-day totals from scout runs. Use this to decide which models to keep enabled and what each task mapping costs." />
      <Tabs defaultValue="model">
        <TabsList>
          <TabsTrigger value="model">By model</TabsTrigger>
          <TabsTrigger value="retailer">By retailer</TabsTrigger>
          <TabsTrigger value="task">By task</TabsTrigger>
        </TabsList>
        <TabsContent value="model">
          <AdminDataTable columns={modelColumns} data={byModel.data} isLoading={byModel.isLoading} caption="Usage by model" emptyMessage="No runs yet." />
        </TabsContent>
        <TabsContent value="retailer">
          <AdminDataTable columns={retailerColumns} data={byRetailer.data} isLoading={byRetailer.isLoading} caption="Usage by retailer" emptyMessage="No runs yet." />
        </TabsContent>
        <TabsContent value="task">
          <AdminDataTable columns={taskColumns} data={byTask.data} isLoading={byTask.isLoading} caption="Usage by background task" emptyMessage="No runs yet." />
        </TabsContent>
      </Tabs>
    </div>
  );
}
