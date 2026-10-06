CREATE TABLE `settlements` (
	`intent_id` text PRIMARY KEY NOT NULL,
	`buyback_mint` text NOT NULL,
	`gross` text NOT NULL,
	`creator_amount` text NOT NULL,
	`buyback_amount` text NOT NULL,
	`minimum_burn` text NOT NULL,
	`collection_tx` text NOT NULL,
	`payout_tx` text,
	`payout_signature` text,
	`payout_height` integer,
	`burn_amount` text,
	`completed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `settlements_payout_signature_unique` ON `settlements` (`payout_signature`);--> statement-breakpoint
CREATE UNIQUE INDEX `one_active_claim_per_token` ON `intents` (`token_id`) WHERE kind='claim' AND status IN ('prepared','submitted');--> statement-breakpoint
CREATE UNIQUE INDEX `one_active_config` ON `intents` (`kind`) WHERE kind='main_config' AND status IN ('prepared','submitted');