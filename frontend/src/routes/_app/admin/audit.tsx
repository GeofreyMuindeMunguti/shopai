/**
 * Admin ▸ Audit log, rendered by the JSON UI engine (src/pages/admin-audit.json).
 */
import { createFileRoute } from '@tanstack/react-router';
import { UIEngine } from '@/engine';
import type { PageDefinition } from '@/engine/types';
import auditPage from '@/pages/admin-audit.json';

export const Route = createFileRoute('/_app/admin/audit')({
  component: () => <UIEngine page={auditPage as PageDefinition} />,
});
