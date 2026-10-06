import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync,readdirSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {migratePostgres,postgresSql} from '../lib/postgres';
async function constraints(query:(sql:string,args?:any[])=>Promise<any[]>){
 const insert="INSERT INTO intents(id,token_id,wallet,kind,message_hash,mint,vault,status,last_valid_height,created_at) VALUES(?,?,'owner',?,'hash','mint','vault',?,100,1)";
 await query(insert,['a','coin','claim','submitted']);
 await assert.rejects(query(insert,['b','coin','claim','submitted']));
 await query(insert,['c','different-coin','claim','submitted']);
 await query("UPDATE intents SET status='confirmed' WHERE id='a'");
 await query(insert,['b','coin','claim','submitted']);
 await query(insert,['setup','cfg','main_config','prepared']);
 await assert.rejects(query(insert,['setup2','other','main_config','prepared']));
 await query("INSERT INTO deployment_settings(key,value) VALUES('METEORA_CONFIG_KEY','original') ON CONFLICT(key) DO NOTHING");
 await query("INSERT INTO deployment_settings(key,value) VALUES('METEORA_CONFIG_KEY','replacement') ON CONFLICT(key) DO NOTHING");
 assert.equal((await query("SELECT value FROM deployment_settings WHERE key='METEORA_CONFIG_KEY'"))[0].value,'original');
 await query("INSERT INTO settlements(intent_id,buyback_mint,gross,creator_amount,buyback_amount,minimum_burn,collection_tx) VALUES('b','target','10000','9000','1000','10','signed-collection')");
 const save='UPDATE settlements SET payout_signature=?,payout_tx=? WHERE intent_id=? AND payout_signature IS NULL AND completed_at IS NULL';
 await Promise.all([query(save,['first','tx1','b']),query(save,['second','tx2','b'])]);
 const row=(await query("SELECT payout_signature,payout_tx FROM settlements WHERE intent_id='b'"))[0];
 assert.ok((row.payout_signature==='first'&&row.payout_tx==='tx1')||(row.payout_signature==='second'&&row.payout_tx==='tx2'));
 await query("UPDATE settlements SET completed_at=1 WHERE intent_id='b'");
 await query(save,['third','tx3','b']);assert.deepEqual((await query("SELECT payout_signature,payout_tx FROM settlements WHERE intent_id='b'"))[0],row);
}
test('SQLite enforces one pending claim, one configuration and durable payout compare-and-swap',async()=>{
 const db=new DatabaseSync(':memory:');try{
  for(const f of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())db.exec(readFileSync(`drizzle/${f}`,'utf8'));
  await constraints(async(sql,args=[])=>db.prepare(sql).all(...args));
 }finally{db.close();}
});
test('PostgreSQL enforces identical pending claim and payout constraints',async()=>{
 const pg=new PGlite();try{
  await migratePostgres({query:async(sql,args)=>sql.startsWith('SELECT pg_advisory')?{rows:[]}:pg.query<Record<string,unknown>>(sql,args)});
  await constraints(async(sql,args)=>(await pg.query(postgresSql(sql),args)).rows);
 }finally{await pg.close();}
});
