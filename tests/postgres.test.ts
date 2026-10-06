import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {migratePostgres,postgresSql,postgresOptions,databaseDiagnostic} from '../lib/postgres';
import {recipientWrites,verificationWrites} from '../lib/bio-store';
test('separate database fields preserve password punctuation and diagnostics never include secrets',()=>{
 const password='test@:/?#%';const options=postgresOptions({PGHOST:'postgres',PGPASSWORD:password});assert.equal(options?.password,password);assert.equal(options?.host,'postgres');assert.equal(options?.connectionString,undefined);
 assert.deepEqual(postgresOptions({DATABASE_URL:'postgres://localhost/qa'}),{connectionString:'postgres://localhost/qa'});assert.equal(postgresOptions({}),undefined);
 const message=databaseDiagnostic({code:'28P01',message:password,connectionString:password});assert.match(message,/original password/);assert.ok(!message.includes(password));assert.ok(!databaseDiagnostic({code:password}).includes(password));
});

test('PostgreSQL migrations and ownership writes preserve unclaimed fees and consume proof once',async()=>{
 const pg=new PGlite();
 // PGlite is a single connection; production takes this lock across pooled clients.
 const client={query:async(sql:string,args?:unknown[])=>sql.startsWith('SELECT pg_advisory')?{rows:[]}:pg.query<Record<string,unknown>>(sql,args)};
 try{
  await migratePostgres(client);await migratePostgres(client);
  const now=Date.now(),code='INSTARA-0123456789abcdef0123456789abcdef';
  await pg.query<Record<string,unknown>>('INSERT INTO sessions(token_hash,wallet,expires_at) VALUES($1,$2,$3)',['s','w',now+60000]);
  const c={id:'proof',account_id:'instagram-public:123',username:'creator',code,expires_at:now+60000,phase:'checking',wallet:'w',session_hash:'s'};
  await pg.query<Record<string,unknown>>('INSERT INTO bio_challenges(id,session_hash,wallet,username,account_id,code,expires_at,phase,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[c.id,'s','w',c.username,c.account_id,code,c.expires_at,c.phase,now]);
  const profile={id:c.account_id,username:c.username,biography:code,followers:25,picture:null,name:'Creator'};
  for(const w of recipientWrites(profile,now))await pg.query<Record<string,unknown>>(postgresSql(w.sql),w.args);
  assert.equal((await pg.query<Record<string,unknown>>('SELECT claimed_at FROM creators')).rows[0].claimed_at,null);
  const writes=verificationWrites(c,profile,{wallet:'w',token_hash:'s'},now);
  await pg.transaction(async tx=>{for(const w of writes)await tx.query(postgresSql(w.sql),w.args);});
  assert.equal(Number((await pg.query<Record<string,unknown>>('SELECT claimed_at FROM creators')).rows[0].claimed_at),now);
  await pg.query<Record<string,unknown>>('UPDATE sessions SET creator_id=NULL');
  await pg.transaction(async tx=>{for(const w of writes)await tx.query(postgresSql(w.sql),w.args);});
  assert.equal((await pg.query<Record<string,unknown>>('SELECT creator_id FROM sessions')).rows[0].creator_id,null);
  await assert.rejects(pg.transaction(async tx=>{await tx.query('DELETE FROM creators');await tx.query('SELECT no_such_column FROM creators');}));
  assert.equal((await pg.query<Record<string,unknown>>('SELECT id FROM creators')).rows.length,1);
  const rate='INSERT INTO rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=rate_limits.count+1 RETURNING count';
  await pg.query<Record<string,unknown>>(postgresSql(rate),['test',now]);assert.equal(Number((await pg.query<Record<string,unknown>>(postgresSql(rate),['test',now])).rows[0].count),2);
 }finally{await pg.close();}
});
