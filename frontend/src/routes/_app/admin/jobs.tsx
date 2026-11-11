/**
 * Admin ▸ Jobs: the workflow_jobs outbox (ADR-0002). Queued jobs older than
 * 5 minutes usually mean the worker or Temporal is down.
 */
import { createFileRoute } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { AdminDataTable } from '@/components/app/AdminDataTable';
import { AdminPageHeader } from '@/components/app/AdminLayout';
import { useJobs } from '@/data/admin';
import type { WorkflowJob } from '@/data/types';
import { timeAgo } from '@/lib/format';

export const Route = createFileRoute('/_app/admin/jobs')({
  component: JobsPage,
});

const columns: ColumnDef<WorkflowJob, any>[] = [
  { accessorKey: 'created_at', header: 'Created', cell: ({ getValue }) => timeAgo(getValue() as string) },
  { accessorKey: 'job_type', header: 'Type' },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ getValue }) => {
      const s = getValue() as string;
      return <Badge variant={s === 'failed' ? 'destructive' : s === 'dispatched' ? 'secondary' : 'outline'}>{s}</Badge>;
    },
  },
  { id: 'attempts', header: 'Attempts', accessorFn: (j) => `${j.attempts}/${j.max_attempts}` },
  { accessorKey: 'workflow_id', header: 'Workflow ID', cell: ({ getValue }) => <code className="text-xs">{(getValue() as string) ?? '—'}</code> },
  { id: 'payload', header: 'Payload', accessorFn: (j) => JSON.stringify(j.payload), cell: ({ getValue }) => <code className="text-xs">{getValue() as string}</code> },
  { accessorKey: 'last_error', header: 'Last error', cell: ({ getValue }) => <span className="text-xs text-destructive">{(getValue() as string) ?? ''}</span> },
];

function JobsPage() {
  const jobs = useJobs();
  const stuck = (jobs.data ?? []).filter((j) => j.status === 'queued' && Date.now() - new Date(j.available_at).getTime() > 5 * 60_000);
  return (
    <div className="space-y-6">
      <AdminPageHeader title="Jobs" description="Requests waiting for, or handed to, the Temporal worker. Refreshes every 10 seconds." />
      {stuck.length > 0 && (
        <Alert variant="destructive">
          <AlertTitle>{stuck.length} job(s) waiting more than 5 minutes</AlertTitle>
          <AlertDescription>Check that the Temporal worker and server are running.</AlertDescription>
        </Alert>
      )}
      <AdminDataTable columns={columns} data={jobs.data} isLoading={jobs.isLoading} caption="Workflow jobs" emptyMessage="No jobs yet." />
    </div>
  );
}
