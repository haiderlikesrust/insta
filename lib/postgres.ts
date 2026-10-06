import pg from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
pg.types.setTypeParser(20,value=>{const n=Number(value);if(!Number.isSafeInteger(n))throw new Error('Database integer exceeds safe range');return n;});
export const postgresSql=(sql:string)=>{let i=0;return sql.replace(/\?/g,()=>`$${++i}`);};
export const postgresMigration=(sql:string)=>sql.replace(/`([^`]+)`/g,'"$1"').replace(/\binteger\b/gi,'BIGINT');
type Row=Record<string,unknown>;
export interface QueryClient {query(sql:string,args?:unknown[]):Promise<{rows:Row[]}>;}
export async function migratePostgres(client:QueryClient,directory=resolve('drizzle')){
 await client.query('BEGIN');try{
  await client.query('SELECT pg_advisory_xact_lock(91137025)');
  await client.query('CREATE TABLE IF NOT EXISTS _instara_migrations(name TEXT PRIMARY KEY,applied_at BIGINT NOT NULL)');
  for(const name of readdirSync(directory).filter(n=>n.endsWith('.sql')).sort()){
   if((await client.query('SELECT name FROM _instara_migrations WHERE name=$1',[name])).rows.length)continue;
   const contents=postgresMigration(readFileSync(resolve(directory,name),'utf8'));
   for(const sql of contents.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await client.query(sql);
   await client.query('INSERT INTO _instara_migrations(name,applied_at) VALUES($1,$2)',[name,Date.now()]);
  }
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK');throw e;}
}
export class PreparedStatement {
 constructor(readonly database:PostgresDatabase,readonly sql:string,readonly args:unknown[]=[]){ }
 bind(...args:unknown[]){return new PreparedStatement(this.database,this.sql,args);}
 async first<T=Row>(){return (await this.database.query(this.sql,this.args)).rows[0] as T??null;}
 async all<T=Row>(){return {results:(await this.database.query(this.sql,this.args)).rows as T[]};}
 async run(){return {success:true,results:(await this.database.query(this.sql,this.args)).rows};}
}
export class PostgresDatabase {
 private pool:pg.Pool;private ready:Promise<void>|null=null;
 constructor(url:string){this.pool=new pg.Pool({connectionString:url,max:10,connectionTimeoutMillis:8000,query_timeout:15000});this.pool.on('error',()=>console.error('Database connection interrupted'));}
 private initialize(){if(!this.ready)this.ready=(async()=>{const c=await this.pool.connect();try{await migratePostgres(c);}finally{c.release();}})().catch(e=>{this.ready=null;throw e;});return this.ready;}
 prepare(sql:string){return new PreparedStatement(this,sql);}
 async query(sql:string,args:unknown[]=[]){await this.initialize();return this.pool.query(postgresSql(sql),args);}
 async batch(statements:PreparedStatement[]){
  await this.initialize();
  for(let attempt=0;attempt<3;attempt++){
   const c=await this.pool.connect();try{
    await c.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    const results=[];for(const statement of statements){if(statement.database!==this)throw new Error('Mismatched database');results.push({success:true,results:(await c.query(postgresSql(statement.sql),statement.args)).rows});}
    await c.query('COMMIT');return results;
   }catch(e){await c.query('ROLLBACK');if(!['40001','40P01'].includes((e as {code?:string}).code||'')||attempt===2)throw e;}finally{c.release();}
  }
  throw new Error('Database transaction unavailable');
 }
 async close(){await this.pool.end();}
}
