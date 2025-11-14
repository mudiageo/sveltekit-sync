import { pgTable, text, boolean, timestamp, integer, jsonb, uuid } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
	id: uuid('id').primaryKey(),
	age: integer('age')
});

// All synced tables must include these columns
export const syncMetadata = {
  _version: integer('_version').notNull().default(1),
  _updatedAt: timestamp('_updated_at').notNull().defaultNow(),
  _clientId: text('_client_id'),
  _isDeleted: boolean('_is_deleted').default(false)
};

export const todos = pgTable('todos', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  text: text('text').notNull(),
  completed: boolean('completed').default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  ...syncMetadata
});

export const notes = pgTable('notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  tags: jsonb('tags').$type<string[]>().default([]),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  ...syncMetadata
});

// Sync log table - tracks all changes for efficient delta sync
export const syncLog = pgTable('sync_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  tableName: text('table_name').notNull(),
  recordId: text('record_id').notNull(),
  operation: text('operation').notNull(), // 'insert', 'update', 'delete'
  data: jsonb('data'),
  timestamp: timestamp('timestamp').notNull().defaultNow(),
  clientId: text('client_id'),
  userId: text('user_id').notNull()
});

// Client state table - track last sync for each client
export const clientState = pgTable('client_state', {
  clientId: text('client_id').primaryKey(),
  userId: text('user_id').notNull(),
  lastSync: timestamp('last_sync').notNull().defaultNow(),
  lastActive: timestamp('last_active').notNull().defaultNow()
});