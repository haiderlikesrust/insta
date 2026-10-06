CREATE TABLE `challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet` text NOT NULL,
	`message` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `creators` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`verified_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `creators_username_unique` ON `creators` (`username`);--> statement-breakpoint
CREATE TABLE `intents` (
	`id` text PRIMARY KEY NOT NULL,
	`token_id` text NOT NULL,
	`wallet` text NOT NULL,
	`kind` text NOT NULL,
	`message_hash` text NOT NULL,
	`mint` text NOT NULL,
	`vault` text NOT NULL,
	`signature` text,
	`status` text NOT NULL,
	`last_valid_height` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `intents_signature_unique` ON `intents` (`signature`);--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`state_hash` text PRIMARY KEY NOT NULL,
	`session_hash` text NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`wallet` text NOT NULL,
	`creator_id` text,
	`verified_at` integer,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`wallet` text NOT NULL,
	`name` text NOT NULL,
	`symbol` text NOT NULL,
	`description` text NOT NULL,
	`handle` text NOT NULL,
	`creator_id` text,
	`image` text NOT NULL,
	`metadata_uri` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`mint` text,
	`vault` text,
	`signature` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tokens_mint_unique` ON `tokens` (`mint`);--> statement-breakpoint
CREATE UNIQUE INDEX `tokens_signature_unique` ON `tokens` (`signature`);--> statement-breakpoint
CREATE INDEX `idx_tokens_wallet_status` ON `tokens` (`wallet`,`status`);--> statement-breakpoint
CREATE INDEX `idx_tokens_status` ON `tokens` (`status`);--> statement-breakpoint
CREATE INDEX `idx_tokens_creator` ON `tokens` (`creator_id`);