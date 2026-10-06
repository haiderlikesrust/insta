CREATE TABLE `recipient_lookups` (
	`id` text PRIMARY KEY NOT NULL,
	`session_hash` text NOT NULL,
	`wallet` text NOT NULL,
	`username` text NOT NULL,
	`run_id` text,
	`phase` text NOT NULL,
	`error` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_recipient_session` ON `recipient_lookups` (`session_hash`,`created_at`);--> statement-breakpoint
ALTER TABLE `creators` ADD `profile_at` integer DEFAULT 0 NOT NULL;