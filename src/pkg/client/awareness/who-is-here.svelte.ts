import type { UsePresenceReturn } from '../hooks/usePresence.svelte.js';

export interface UserAvatar {
  user: {
    id: string;
    name?: string;
    avatar?: string;
    [key: string]: any;
  };
  color: string;
  status: 'online' | 'idle' | 'away';
}

/**
 * Generate a consistent color for a user ID
 */
function generateUserColor(userId: string): string {
  const colors = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8',
    '#F7DC6F', '#BB8FCE', '#85C1E2', '#F8B739', '#52B788',
    '#FF8FAB', '#6C5CE7', '#FD79A8', '#FDCB6E', '#A29BFE'
  ];
  
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  return colors[Math.abs(hash) % colors.length];
}

/**
 * "Who's here" helper - displays avatars and count of online users.
 * Provides a simple way to show collaboration presence.
 */
export function useWhoIsHere<T = any>(presence: UsePresenceReturn<T>): {
  users: UserAvatar[];
  count: number;
  onlineCount: number;
  isAlone: boolean;
} {
  const users = $derived(
    presence.others
      .filter(p => p.status !== 'away')
      .map(p => ({
        user: p.user || { id: p.userId },
        color: generateUserColor(p.userId),
        status: p.status
      }))
  );
  
  const count = $derived(users.length);
  const onlineCount = $derived(users.filter(u => u.status === 'online').length);
  const isAlone = $derived(count === 0);
  
  return {
    get users() {
      return users;
    },
    get count() {
      return count;
    },
    get onlineCount() {
      return onlineCount;
    },
    get isAlone() {
      return isAlone;
    }
  };
}
