/**
 * Admin portal shell. The client hides it for non-admins; the server enforces
 * access through is_admin() RLS policies and admin RPCs.
 */
import { createFileRoute, Outlet } from '@tanstack/react-router';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AdminLayout } from '@/components/app/AdminLayout';
import { useAuth } from '@/hooks/useAuth';

export const Route = createFileRoute('/_app/admin')({
  component: AdminRoute,
});

function AdminRoute() {
  const { isAdmin } = useAuth();
  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-xl p-4 sm:p-6">
        <Alert variant="destructive">
          <AlertTitle>Admins only</AlertTitle>
          <AlertDescription>Your account doesn't have access to the admin portal.</AlertDescription>
        </Alert>
      </div>
    );
  }
  return (
    <AdminLayout>
      <Outlet />
    </AdminLayout>
  );
}
