import { PostgresDatabase, postgresOptions } from './postgres';
let database:PostgresDatabase|undefined;
// Selected only by the standalone Node build. Secrets are read at runtime.
export const env=new Proxy({} as Record<string,unknown>,{get(_target,key){if(key==='DB'){const options=postgresOptions(process.env);if(!options)return undefined;return database??=new PostgresDatabase(options);}return typeof key==='string'?process.env[key]:undefined;}});
