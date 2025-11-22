import type { SQL } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { SyncConfig } from '$pjg/types'

// Define your sync schema - what gets synced and who can access it
export const syncSchema: SyncConfig = {
  tables: {
    todos: {
      table: 'todos',
      columns: ['id', 'text', 'completed', 'userId', 'createdAt', 'updatedAt', '_version', '_updatedAt'],
      // Only sync todos for the current user
      where: (userId: string) => sql`user_id = ${userId}`,
      conflictResolution: 'last-write-wins'
    },
    
    notes: {
      table: 'notes',
      columns: ['id', 'title', 'content', 'userId', 'tags', 'createdAt', '_version', '_updatedAt'],
      where: (userId: string) => sql`user_id = ${userId}`,
      // Remove sensitive data before sending to client
      transform: (note) => {
        const { internalNotes, ...safeNote } = note;
        return safeNote;
      }
    },
    
    // Shared data example - todos from team workspace
    teamTodos: {
      table: 'todos',
      columns: ['id', 'text', 'completed', 'teamId', 'assignedTo', 'createdAt', '_version', '_updatedAt'],
      // Sync todos from teams user belongs to
      // where: (userId: string) => sql`team_id IN (
      //   SELECT team_id FROM team_members WHERE user_id = ${userId}
      // )`
    }
  },
  batchSize: 100,
  enableRealtime: true
};