import { db } from '$lib/server/db'
import * as schema from '$lib/server/db/schema'
import { ServerSyncEngine } from '$pkg/server/sync-engine';
import { DrizzleAdapter } from '$pkg/adapters/drizzle';
import { syncSchema } from './sync-schema';

const adapter = new DrizzleAdapter({ db, schema })
export const syncEngine = new ServerSyncEngine(adapter, syncSchema);
