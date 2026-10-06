// Intentionally empty by default.
// Add Drizzle tables here when the site actually needs a database.
// See examples/d1/db/schema.ts for an opt-in example.
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
export const creators = sqliteTable("creators", { id: text().primaryKey(), username: text().notNull().unique(), verified_at: integer().notNull() });
export const sessions = sqliteTable("sessions", { token_hash: text().primaryKey(), wallet: text().notNull(), creator_id: text(), verified_at: integer(), expires_at: integer().notNull() });
export const challenges = sqliteTable("challenges", { id: text().primaryKey(), wallet: text().notNull(), message: text().notNull(), expires_at: integer().notNull() });
export const oauthStates = sqliteTable("oauth_states", { state_hash: text().primaryKey(), session_hash: text().notNull(), expires_at: integer().notNull() });
export const tokens = sqliteTable("tokens", { id: text().primaryKey(), wallet: text().notNull(), name: text().notNull(), symbol: text().notNull(), description: text().notNull(), handle: text().notNull(), creator_id: text(), image: text().notNull(), metadata_uri: text().notNull(), status: text().notNull().default("draft"), mint: text().unique(), vault: text(), signature: text().unique(), created_at: integer().notNull() }, t => [index("idx_tokens_wallet_status").on(t.wallet, t.status), index("idx_tokens_status").on(t.status), index("idx_tokens_creator").on(t.creator_id)]);
export const intents = sqliteTable("intents", { id: text().primaryKey(), token_id: text().notNull(), wallet: text().notNull(), kind: text().notNull(), message_hash: text().notNull(), mint: text().notNull(), vault: text().notNull(), signature: text().unique(), status: text().notNull(), last_valid_height: integer().notNull(), created_at: integer().notNull() });
export const rateLimits = sqliteTable("rate_limits", { key: text().primaryKey(), count: integer().notNull(), expires_at: integer().notNull() });
