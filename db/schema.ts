import {sql} from 'drizzle-orm';
// Intentionally empty by default.
// Add Drizzle tables here when the site actually needs a database.
// See examples/d1/db/schema.ts for an opt-in example.
import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
export const creators = sqliteTable("creators", { id: text().primaryKey(), username: text().notNull().unique(), verified_at: integer().notNull(), profile_at: integer().notNull().default(0), claimed_at: integer(), followers: integer(), biography: text(), picture: text() });
export const recipientLookups=sqliteTable("recipient_lookups",{id:text().primaryKey(),session_hash:text().notNull(),wallet:text().notNull(),username:text().notNull(),run_id:text(),phase:text().notNull(),error:text(),created_at:integer().notNull()},t=>[index("idx_recipient_session").on(t.session_hash,t.created_at)]);
export const bioChallenges = sqliteTable("bio_challenges", { id: text().primaryKey(), session_hash: text().notNull(), wallet: text().notNull(), username: text().notNull(), account_id: text(), code: text().notNull(), expires_at: integer().notNull(), phase: text().notNull(), lookup_run_id: text(), check_run_id: text(), profile_json: text(), error: text(), created_at: integer().notNull() }, t => [index("idx_bio_session").on(t.session_hash,t.created_at)]);
export const sessions = sqliteTable("sessions", { token_hash: text().primaryKey(), wallet: text().notNull(), creator_id: text(), verified_at: integer(), expires_at: integer().notNull() });
export const challenges = sqliteTable("challenges", { id: text().primaryKey(), wallet: text().notNull(), message: text().notNull(), expires_at: integer().notNull() });
export const oauthStates = sqliteTable("oauth_states", { state_hash: text().primaryKey(), session_hash: text().notNull(), expires_at: integer().notNull() });
export const tokens = sqliteTable("tokens", { id: text().primaryKey(), recipient_type: text().notNull().default('instagram'), wallet: text().notNull(), name: text().notNull(), symbol: text().notNull(), description: text().notNull(), handle: text().notNull(), creator_id: text(), image: text().notNull(), metadata_uri: text().notNull(), website:text().notNull().default(''), twitter:text().notNull().default(''), telegram:text().notNull().default(''), dev_buy_usd:text().notNull().default('0'), dev_buy_sol:text().notNull().default('0'), revision:integer().notNull().default(0), launched_at:integer(), status: text().notNull().default("draft"), mint: text().unique(), vault: text(), signature: text().unique(), created_at: integer().notNull() }, t => [index("idx_tokens_wallet_status").on(t.wallet, t.status), index("idx_tokens_status").on(t.status), index("idx_tokens_creator").on(t.creator_id)]);
export const intents = sqliteTable("intents", { id: text().primaryKey(), token_id: text().notNull(), wallet: text().notNull(), kind: text().notNull(), message_hash: text().notNull(), mint: text().notNull(), vault: text().notNull(), signature: text().unique(), signed_transaction:text(), prepared_transaction:text(), submitted_message_hash:text(), last_broadcast_at:integer().notNull().default(0), status: text().notNull(), last_valid_height: integer().notNull(), created_at: integer().notNull() },t=>[
 uniqueIndex('one_active_claim_per_token').on(t.token_id).where(sql`kind='claim' AND status IN ('prepared','submitted')`),
 uniqueIndex('one_active_config').on(t.kind).where(sql`kind IN ('main_config','main_lookup') AND status IN ('prepared','submitted')`)
]);
export const rateLimits = sqliteTable("rate_limits", { key: text().primaryKey(), count: integer().notNull(), expires_at: integer().notNull() });
export const deploymentSettings=sqliteTable('deployment_settings',{key:text().primaryKey(),value:text().notNull()});
export const media=sqliteTable('media',{id:text().primaryKey(),content_type:text().notNull(),data:text().notNull(),created_at:integer().notNull()});
export const metadata=sqliteTable('metadata',{id:text().primaryKey(),data:text().notNull(),created_at:integer().notNull()});

export const settlements=sqliteTable('settlements',{
 intent_id:text().primaryKey(),buyback_mint:text().notNull(),gross:text().notNull(),creator_amount:text().notNull(),buyback_amount:text().notNull(),minimum_burn:text().notNull(),
 collection_tx:text().notNull(),payout_tx:text(),payout_signature:text().unique(),payout_height:integer(),burn_amount:text(),completed_at:integer(),last_attempt_at:integer().notNull().default(0),
});
