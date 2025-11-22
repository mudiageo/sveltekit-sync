import postgres from 'postgres';
import * as schema from './schema';
export declare const db: import("drizzle-orm/postgres-js/driver", { with: { "resolution-mode": "require" } }).PostgresJsDatabase<typeof schema> & {
    $client: postgres.Sql<{}>;
};
