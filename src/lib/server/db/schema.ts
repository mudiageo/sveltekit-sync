import { pgTable, text, boolean, timestamp, integer, jsonb, uuid } from 'drizzle-orm/pg-core';

import { syncMetadata } from '../../../pkg/adapters/drizzle'
export { syncLog, clientState } from '../../../pkg/adapters/drizzle'

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  age: integer('age')
});


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

