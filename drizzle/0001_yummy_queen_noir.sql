CREATE TABLE `bio_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`session_hash` text NOT NULL,
	`wallet` text NOT NULL,
	`username` text NOT NULL,
	`account_id` text,
	`code` text NOT NULL,
	`expires_at` integer NOT NULL,
	`phase` text NOT NULL,
	`lookup_run_id` text,
	`check_run_id` text,
	`profile_json` text,
	`error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_bio_session` ON `bio_challenges` (`session_hash`,`created_at`);--> statement-breakpoint
ALTER TABLE `creators` ADD `followers` integer;--> statement-breakpoint
ALTER TABLE `creators` ADD `biography` text;--> statement-breakpoint
ALTER TABLE `creators` ADD `picture` text;