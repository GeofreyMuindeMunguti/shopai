/**
 * Signed-in app shell. Guards: no session → /login; onboarding incomplete →
 * /onboarding (FR-0b gates item creation, the DB enforces it too).
 */
import { createFileRoute, Link, Navigate, Outlet, useLocation, useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Heart, LogOut, Menu, Settings, Shield, ShoppingBag } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { NotificationsBell } from '@/components/app/NotificationsBell';
import { ErrorState, FullPageSpinner } from '@/components/app/PageState';
import { useProfile } from '@/data/queries';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/utils';

export const Route = createFileRoute('/_app')({
  component: AppLayout,
});

function AppLayout() {
  const { session, isLoading } = useAuth();
  const profile = useProfile();

  if (isLoading) return <FullPageSpinner />;
  if (!session) return <Navigate to="/login" />;
  if (profile.isLoading) return <FullPageSpinner label="Loading your profile…" />;
  if (profile.error) return <div className="p-4 sm:p-6"><ErrorState error={profile.error} /></div>;
  if (!profile.data?.onboarding_completed_at) return <Navigate to="/onboarding" />;

  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-background focus:p-2">
        Skip to content
      </a>
      <Header />
      <main id="main" tabIndex={-1} className="focus:outline-none">
        <Outlet />
      </main>
    </>
  );
}

type NavEntry = { to: '/' | '/settings' | '/admin'; label: string; icon: typeof Heart; exact?: boolean };

/** Single source for the desktop nav and the mobile sheet so they cannot drift apart. */
function navEntries(isAdmin: boolean): NavEntry[] {
  return [
    { to: '/', label: 'My Wishlists', icon: Heart, exact: true },
    { to: '/settings', label: 'Settings', icon: Settings },
    ...(isAdmin ? [{ to: '/admin' as const, label: 'Admin', icon: Shield }] : []),
  ];
}

function NavItem({ to, label, icon: Icon, exact, className, onClick }: NavEntry & { className?: string; onClick?: () => void }) {
  const { pathname } = useLocation();
  const active = exact ? pathname === to || pathname.startsWith('/wishlists') : pathname.startsWith(to);
  return (
    <Link
      to={to}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        active ? 'bg-primary text-primary-foreground' : 'hover:bg-muted',
        className
      )}
    >
      <Icon className="h-4 w-4" aria-hidden />
      {label}
    </Link>
  );
}

function Header() {
  const { user, isAdmin, signOut } = useAuth();
  const { data: profile } = useProfile();
  const navigate = useNavigate();
  const name = profile?.display_name || user?.email || 'You';
  const nav = navEntries(isAdmin);
  const { pathname } = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the mobile menu whenever the route changes (back/forward included).
  useEffect(() => setMenuOpen(false), [pathname]);

  return (
    <header className="sticky top-0 z-40 border-b bg-card">
      <div className="flex h-16 items-center gap-2 px-4 sm:gap-4 sm:px-6">
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
              <Menu aria-hidden />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" aria-describedby={undefined}>
            <SheetTitle className="flex items-center gap-2 text-lg font-semibold">
              <ShoppingBag className="h-5 w-5 text-primary" aria-hidden /> Scout
            </SheetTitle>
            <nav aria-label="Main" className="mt-6 flex flex-col gap-1">
              {nav.map((n) => (
                <NavItem key={n.to} {...n} className="min-h-10" onClick={() => setMenuOpen(false)} />
              ))}
            </nav>
          </SheetContent>
        </Sheet>
        <Link to="/" className="flex items-center gap-2 text-lg font-semibold">
          <ShoppingBag className="h-5 w-5 text-primary" aria-hidden /> Scout
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {nav.map((n) => (
            <NavItem key={n.to} {...n} />
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <NotificationsBell />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="rounded-full" aria-label="Account menu">
                <Avatar className="h-8 w-8">
                  {profile?.avatar_url && <AvatarImage src={profile.avatar_url} alt="" />}
                  <AvatarFallback>{name.slice(0, 1).toUpperCase()}</AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>
                <span className="block truncate">{name}</span>
                <span className="block truncate text-xs font-normal text-muted-foreground">{user?.email}</span>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => navigate({ to: '/settings' })}>
                <Settings aria-hidden /> Settings
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={async () => {
                  await signOut();
                  navigate({ to: '/login' });
                }}
              >
                <LogOut aria-hidden /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
