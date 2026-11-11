import { Bell } from 'lucide-react';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useMarkNotificationRead, useNotifications } from '@/data/queries';
import { useNotificationsRealtime } from '@/hooks/useRealtime';
import { useAuth } from '@/hooks/useAuth';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/utils';

export function NotificationsBell() {
  const { user } = useAuth();
  useNotificationsRealtime(user?.id);
  const { data = [] } = useNotifications();
  const markRead = useMarkNotificationRead();
  const unread = data.filter((n) => !n.read_at).length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
          <Bell aria-hidden />
          {unread > 0 && (
            <span aria-hidden className="absolute right-1.5 top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[calc(100vw-2rem)] max-w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <h2 className="text-sm font-semibold">Notifications</h2>
          <Button variant="link" size="sm" className="h-auto p-0" disabled={!unread} onClick={() => markRead.mutate('all')}>
            Mark all read
          </Button>
        </div>
        <ScrollArea className="max-h-96">
          {data.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">You're all caught up.</p>
          ) : (
            <ul>
              {data.slice(0, 15).map((n) => (
                <li key={n.id} className={cn('border-b px-3 py-2 last:border-0', !n.read_at && 'bg-muted/50')}>
                  {n.data?.wishlist_id ? (
                    <Link
                      to="/wishlists/$wishlistId"
                      params={{ wishlistId: String(n.data.wishlist_id) }}
                      className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => !n.read_at && markRead.mutate(n.id)}
                    >
                      <NotificationBody title={n.title} body={n.body} at={n.created_at} unread={!n.read_at} />
                    </Link>
                  ) : (
                    <button type="button" className="block w-full text-left" onClick={() => !n.read_at && markRead.mutate(n.id)}>
                      <NotificationBody title={n.title} body={n.body} at={n.created_at} unread={!n.read_at} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
        <div className="border-t px-3 py-2 text-right">
          <Link to="/settings" search={{ tab: 'notifications' }} className="text-sm text-primary underline-offset-4 hover:underline">
            All notifications
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function NotificationBody({ title, body, at, unread }: { title: string; body: string | null; at: string; unread: boolean }) {
  return (
    <>
      <p className="text-sm font-medium">
        {unread && <span className="sr-only">Unread: </span>}
        {title}
      </p>
      {body && <p className="text-sm text-muted-foreground">{body}</p>}
      <p className="text-xs text-muted-foreground">{timeAgo(at)}</p>
    </>
  );
}
