/**
 * "Who's Here" Utility
 * 
 * Simplified helper for displaying online users.
 */
import type { UsePresenceReturn } from '../hooks/usePresence.svelte.js';
import type { User } from '../presence.svelte.js';

export interface WhoIsHereReturn {
  users: User[];
  avatars: Array<{ user: User; color: string }>;
  count: number;
  onlineCount: number;
  isAlone: boolean;
}

/**
 * Get information about who's online
 * 
 * @param presence - The presence hook instance
 * @returns Who's here information
 * 
 * @example
 * ```svelte
 * <script>
 *   const presence = usePresence(channel, currentUser);
 *   const whoIsHere = useWhoIsHere(presence);
 * </script>
 * 
 * <div class="avatars">
 *   {#if whoIsHere.isAlone}
 *     <p>You're the only one here</p>
 *   {:else}
 *     <p>{whoIsHere.onlineCount} people online</p>
 *     {#each whoIsHere.avatars as { user, color }}
 *       <div class="avatar" style="background: {color}">
 *         {user.name[0]}
 *       </div>
 *     {/each}
 *   {/if}
 * </div>
 * ```
 */
export function useWhoIsHere(presence: UsePresenceReturn<any>): WhoIsHereReturn {
  const users = $derived.by(() => {
    return [presence.myPresence.user, ...presence.others.map(p => p.user)];
  });

  const avatars = $derived.by(() => {
    return users.map(user => ({
      user,
      color: user.color || generateUserColor(user.id)
    }));
  });

  const count = $derived(users.length);
  const onlineCount = $derived(presence.onlineCount);
  const isAlone = $derived(presence.othersCount === 0);

  return {
    get users() {
      return users;
    },
    get avatars() {
      return avatars;
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

/**
 * Generate a consistent color for a user based on their ID
 */
function generateUserColor(userId: string): string {
  const colors = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A',
    '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E2',
    '#F06292', '#AED581', '#FFD54F', '#4DD0E1'
  ];
  
  // Generate a hash from the user ID
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  return colors[Math.abs(hash) % colors.length];
}
