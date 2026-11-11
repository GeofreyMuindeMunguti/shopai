import type { ReactNode } from 'react';
import { Link, useLocation } from '@tanstack/react-router';
import { Activity, Bot, Cpu, FileClock, ListChecks, Settings2, Store, Truck } from 'lucide-react';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  sidebarMenuButtonClass,
} from '@/components/ui/sidebar';

export const ADMIN_NAV = [
  { to: '/admin/models', label: 'AI models', icon: Bot },
  { to: '/admin/tasks', label: 'Background-task models', icon: Cpu },
  { to: '/admin/retailers', label: 'Retailers', icon: Truck },
  { to: '/admin/stores', label: 'Shopify stores', icon: Store },
  { to: '/admin/settings', label: 'Limits & rollout', icon: Settings2 },
  { to: '/admin/usage', label: 'Usage', icon: Activity },
  { to: '/admin/jobs', label: 'Jobs', icon: ListChecks },
  { to: '/admin/audit', label: 'Audit log', icon: FileClock },
] as const;

export function AdminLayout({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const current = ADMIN_NAV.find((n) => pathname.startsWith(n.to));

  return (
    <div className="flex min-h-[calc(100vh-4rem)]">
      <Sidebar aria-label="Admin">
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Admin</SidebarGroupLabel>
            <SidebarMenu>
              {ADMIN_NAV.map((n) => {
                const Icon = n.icon;
                const active = pathname.startsWith(n.to);
                return (
                  <SidebarMenuItem key={n.to}>
                    <Link to={n.to} className={sidebarMenuButtonClass(active)} aria-current={active ? 'page' : undefined}>
                      <Icon aria-hidden /> {n.label}
                    </Link>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <div className="min-w-0 flex-1 space-y-6 p-6">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/admin">Admin</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            {current && (
              <>
                <BreadcrumbSeparator />
                <BreadcrumbItem>
                  <BreadcrumbPage>{current.label}</BreadcrumbPage>
                </BreadcrumbItem>
              </>
            )}
          </BreadcrumbList>
        </Breadcrumb>
        {children}
      </div>
    </div>
  );
}

export function AdminPageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions}
    </div>
  );
}
