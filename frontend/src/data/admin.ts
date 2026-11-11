/**
 * Admin data hooks. Config tables are edited through PostgREST under is_admin()
 * RLS; side effects (default model, model tests, FX refresh) are RPCs.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { supabase } from './supabase';
import { unwrap, RETAILER_COLUMNS } from './queries';
import { toastError } from '@/lib/errors';
import { LLM_MODEL_COLUMNS, type AppSetting, type LlmModel, type Retailer, type ShopifyStore, type TaskModel, type WorkflowJob } from './types';

/** Columns admins may write on llm_models (column-level grants). */
export type LlmModelInput = Pick<
  LlmModel,
  'display_name' | 'description' | 'bedrock_model_id' | 'supports_tools' | 'max_output_tokens' | 'supports_images' | 'cost_note'
>;

export function useAdminModels(pollWhilePending: boolean) {
  return useQuery({
    queryKey: ['admin', 'llm_models'],
    queryFn: () => unwrap<LlmModel[]>(supabase.from('llm_models').select(LLM_MODEL_COLUMNS).is('owner_user_id', null).order('created_at')),
    refetchInterval: pollWhilePending ? 2000 : false,
  });
}

export function useModelTestJobs(pollWhilePending: boolean) {
  return useQuery({
    queryKey: ['admin', 'model_test_jobs'],
    queryFn: () =>
      unwrap<WorkflowJob[]>(
        supabase
          .from('workflow_jobs')
          .select('*')
          .eq('job_type', 'model_test')
          .order('created_at', { ascending: false })
          .limit(50)
      ),
    refetchInterval: pollWhilePending ? 2000 : false,
  });
}

function useInvalidate(...keys: string[][]) {
  const qc = useQueryClient();
  return () => keys.forEach((k) => qc.invalidateQueries({ queryKey: k }));
}

export function useSaveModel() {
  const invalidate = useInvalidate(['admin'], ['available_models']);
  return useMutation({
    mutationFn: ({ id, ...input }: Partial<LlmModelInput> & { id?: string; is_enabled?: boolean }) =>
      id
        ? unwrap<LlmModel>(supabase.from('llm_models').update(input).eq('id', id).select(LLM_MODEL_COLUMNS).single())
        : unwrap<LlmModel>(supabase.from('llm_models').insert(input).select(LLM_MODEL_COLUMNS).single()),
    onSuccess: invalidate,
    onError: (e) => toastError(e, 'Could not save the model'),
  });
}

export function useDeleteModel() {
  const invalidate = useInvalidate(['admin'], ['available_models']);
  return useMutation({
    mutationFn: (id: string) => unwrap<unknown>(supabase.from('llm_models').delete().eq('id', id)),
    onSuccess: invalidate,
    onError: (e) => toastError(e, 'Could not delete the model'),
  });
}

export function useSetDefaultModel() {
  const invalidate = useInvalidate(['admin'], ['available_models']);
  return useMutation({
    mutationFn: (modelId: string) => unwrap<unknown>(supabase.rpc('set_default_model', { model_id: modelId })),
    onSuccess: () => {
      invalidate();
      toast.success('Default model updated');
    },
    onError: (e) => toastError(e, 'Could not set the default'),
  });
}

export function useRequestModelTest() {
  const invalidate = useInvalidate(['admin']);
  return useMutation({
    mutationFn: (modelId: string) => unwrap<{ job_id: string }>(supabase.rpc('request_model_test', { model_id: modelId })),
    onSuccess: invalidate,
    onError: (e) => toastError(e, 'Could not start the test'),
  });
}

export function useTaskModels() {
  return useQuery({
    queryKey: ['admin', 'llm_task_models'],
    queryFn: () => unwrap<TaskModel[]>(supabase.from('llm_task_models').select('id, task_key, model_id').order('task_key')),
  });
}

export function useSaveTaskModel() {
  const invalidate = useInvalidate(['admin', 'llm_task_models']);
  return useMutation({
    mutationFn: ({ taskKey, modelId }: { taskKey: string; modelId: string | null }) =>
      unwrap<unknown>(supabase.from('llm_task_models').update({ model_id: modelId }).eq('task_key', taskKey)),
    onSuccess: () => {
      invalidate();
      toast.success('Task model saved');
    },
    onError: (e) => toastError(e, 'Could not save the mapping'),
  });
}

export function useAdminRetailers() {
  return useQuery({
    queryKey: ['admin', 'retailers'],
    queryFn: () => unwrap<Retailer[]>(supabase.from('retailers').select(RETAILER_COLUMNS).order('display_name')),
  });
}

export function useSaveRetailer() {
  const invalidate = useInvalidate(['admin', 'retailers'], ['retailers']);
  return useMutation({
    mutationFn: ({ id, ...patch }: Partial<Retailer> & { id: string }) =>
      unwrap<unknown>(supabase.from('retailers').update(patch).eq('id', id)),
    onSuccess: () => {
      invalidate();
      toast.success('Retailer saved');
    },
    onError: (e) => toastError(e, 'Could not save the retailer'),
  });
}

export interface StoreFilters {
  status: string;
  country: string;
  category: string;
}

export function useShopifyStores(filters: StoreFilters) {
  return useQuery({
    queryKey: ['admin', 'shopify_stores', filters],
    queryFn: () => {
      let q = supabase.from('shopify_stores').select('*').order('quality_score', { ascending: false, nullsFirst: false }).limit(500);
      if (filters.status !== 'all') q = q.eq('status', filters.status);
      if (filters.country !== 'all') q = q.contains('ships_to', [filters.country]);
      if (filters.category.trim()) q = q.contains('categories', [filters.category.trim()]);
      return unwrap<ShopifyStore[]>(q);
    },
  });
}

export function useShopifyStoreCounts() {
  return useQuery({
    queryKey: ['admin', 'shopify_store_counts'],
    queryFn: async () => {
      const rows = await unwrap<{ status: string }[]>(supabase.from('shopify_stores').select('status'));
      return { total: rows.length, blocked: rows.filter((r) => r.status === 'blocked').length, seed: rows.filter((r) => r.status === 'seed').length };
    },
  });
}

export function useSetStoreStatus() {
  const invalidate = useInvalidate(['admin']);
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: ShopifyStore['status'] }) =>
      unwrap<unknown>(supabase.from('shopify_stores').update({ status }).eq('id', id)),
    onSuccess: invalidate,
    onError: (e) => toastError(e, 'Could not update the store'),
  });
}

export function useAppSettings() {
  return useQuery({
    queryKey: ['admin', 'app_settings'],
    queryFn: () => unwrap<AppSetting[]>(supabase.from('app_settings').select('id, key, value, description, updated_at').order('key')),
  });
}

export function useSaveAppSetting() {
  const invalidate = useInvalidate(['admin', 'app_settings'], ['quota']);
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) =>
      unwrap<unknown>(supabase.from('app_settings').update({ value }).eq('key', key)),
    onSuccess: () => {
      invalidate();
      toast.success('Setting saved');
    },
    onError: (e) => toastError(e, 'Could not save the setting'),
  });
}

export function useAdminView<T>(view: string, order = 'day') {
  return useQuery({
    queryKey: ['admin', view],
    queryFn: () => unwrap<T[]>(supabase.from(view).select('*').order(order, { ascending: false }).limit(500)),
  });
}

export function useJobs() {
  return useQuery({
    queryKey: ['admin', 'workflow_jobs'],
    queryFn: () => unwrap<WorkflowJob[]>(supabase.from('workflow_jobs').select('*').order('created_at', { ascending: false }).limit(200)),
    refetchInterval: 10_000,
  });
}

export function useRequestFxRefresh() {
  const invalidate = useInvalidate(['admin', 'workflow_jobs']);
  return useMutation({
    mutationFn: () => unwrap<{ job_id: string }>(supabase.rpc('request_fx_refresh')),
    onSuccess: () => {
      invalidate();
      toast.success('FX refresh queued');
    },
    onError: (e) => toastError(e, 'Could not queue the FX refresh'),
  });
}
