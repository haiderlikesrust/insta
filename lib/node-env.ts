import { PostgresDatabase } from './postgres';
let database:PostgresDatabase|undefined;
// Selected only by the standalone Node build. Secrets are read at runtime.
export const env=new Proxy({} as Record<string,unknown>,{get(_target,key){if(key==='DB'){if(!process.env.DATABASE_URL)return undefined;return database??=new PostgresDatabase(process.env.DATABASE_URL);}return typeof key==='string'?process.env[key]:undefined;}});
