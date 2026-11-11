import { toast } from 'sonner';

/**
 * RPC validation errors arrive as PostgREST errors with stable codes
 * (WL400 invalid, WL403 forbidden, WL404 not found, WL409 active run, WL429 daily cap).
 */
export interface ApiError {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
}

const TITLES: Record<string, string> = {
  WL400: 'Check the details',
  WL403: 'Not allowed',
  WL404: 'Not found',
  WL409: 'Already searching',
  WL429: 'Daily limit reached',
};

export function errorMessage(error: unknown): string {
  if (!error) return 'Something went wrong';
  if (typeof error === 'string') return error;
  const e = error as ApiError;
  return e.message || 'Something went wrong';
}

export function toastError(error: unknown, fallbackTitle = 'Something went wrong') {
  const e = (error ?? {}) as ApiError;
  const title = (e.code && TITLES[e.code]) || fallbackTitle;
  toast.error(title, { description: errorMessage(error) });
}
