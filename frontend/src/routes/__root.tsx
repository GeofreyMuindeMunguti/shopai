/**
 * Root Route - providers that every page needs. The signed-in app shell lives in _app.tsx.
 */

import { createRootRoute, Outlet } from '@tanstack/react-router';
import { TanStackRouterDevtools } from '@tanstack/router-devtools';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';

export const Route = createRootRoute({
  component: RootComponent,
});

function RootComponent() {
  return (
    <TooltipProvider>
      <div className="min-h-screen bg-background">
        <Outlet />
      </div>
      <Toaster position="bottom-right" richColors closeButton />
      {import.meta.env.DEV && <TanStackRouterDevtools position="bottom-left" />}
    </TooltipProvider>
  );
}
