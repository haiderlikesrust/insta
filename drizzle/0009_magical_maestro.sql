CREATE TABLE `media` (
	`id` text PRIMARY KEY NOT NULL,
	`content_type` text NOT NULL,
	`data` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `metadata` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `tokens` ADD `website` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tokens` ADD `twitter` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tokens` ADD `telegram` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tokens` ADD `dev_buy_usd` text DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE `tokens` ADD `revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `tokens` ADD `launched_at` integer;