ALTER TABLE `intents` ADD `signed_transaction` text;--> statement-breakpoint
ALTER TABLE `intents` ADD `last_broadcast_at` integer DEFAULT 0 NOT NULL;