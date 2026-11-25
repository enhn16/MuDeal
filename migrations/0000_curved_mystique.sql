CREATE TABLE `actors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`disambiguation_note` text,
	`follower_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_actors_norm_name` ON `actors` (`normalized_name`);--> statement-breakpoint
CREATE TABLE `audit_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`actor_user_id` integer,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`payload_json` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_audit_target` ON `audit_logs` (`target_type`,`target_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `deal_helpful_votes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deal_id` integer NOT NULL,
	`user_id` integer,
	`session_hash` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uk_helpful_user` ON `deal_helpful_votes` (`deal_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uk_helpful_sess` ON `deal_helpful_votes` (`deal_id`,`session_hash`);--> statement-breakpoint
CREATE TABLE `deal_issues` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deal_id` integer NOT NULL,
	`reporter_id` integer NOT NULL,
	`issue_type` text NOT NULL,
	`note` text,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`resolved_by` integer,
	`resolved_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reporter_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`resolved_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_issues_status` ON `deal_issues` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `deal_reports` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`reporter_id` integer NOT NULL,
	`reporter_nickname` text NOT NULL,
	`show_id` integer,
	`reported_show_title` text NOT NULL,
	`channel_name` text NOT NULL,
	`external_url` text NOT NULL,
	`deal_type` text NOT NULL,
	`seat_grade` text DEFAULT 'ALL' NOT NULL,
	`reported_price` integer,
	`reported_discount_rate` integer,
	`is_unconditional` integer DEFAULT 1 NOT NULL,
	`condition_note` text,
	`expires_at` text,
	`evidence_r2_key` text,
	`status` text DEFAULT 'PENDING' NOT NULL,
	`reviewer_id` integer,
	`reject_reason_code` text,
	`reject_reason_note` text,
	`reviewed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`reporter_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`reviewer_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_reports_status` ON `deal_reports` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_reports_reporter` ON `deal_reports` (`reporter_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `deals` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`show_id` integer,
	`channel_name` text NOT NULL,
	`deal_type` text NOT NULL,
	`seat_grade` text DEFAULT 'ALL' NOT NULL,
	`base_price` integer,
	`sale_price` integer,
	`discount_rate` integer,
	`is_unconditional` integer DEFAULT 1 NOT NULL,
	`condition_tags_json` text,
	`condition_summary` text,
	`opens_at` text,
	`event_dates_json` text,
	`perk_summary` text,
	`fee_info` text,
	`external_url` text NOT NULL,
	`external_key` text,
	`expires_at` text,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`source_type` text NOT NULL,
	`source_report_id` integer,
	`source_ocr_job_id` integer,
	`reporter_nickname` text,
	`click_count` integer DEFAULT 0 NOT NULL,
	`helpful_count` integer DEFAULT 0 NOT NULL,
	`admin_locked` integer DEFAULT 0 NOT NULL,
	`last_verified_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_report_id`) REFERENCES `deal_reports`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_ocr_job_id`) REFERENCES `ocr_image_jobs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `deals_external_key_unique` ON `deals` (`external_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `deals_source_report_id_unique` ON `deals` (`source_report_id`);--> statement-breakpoint
CREATE INDEX `idx_deals_compare` ON `deals` (`show_id`,`status`,`seat_grade`,`sale_price`,`is_unconditional`);--> statement-breakpoint
CREATE INDEX `idx_deals_community` ON `deals` (`source_type`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_deals_price_filter` ON `deals` (`status`,`sale_price`,`is_unconditional`);--> statement-breakpoint
CREATE INDEX `idx_deals_drafts` ON `deals` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_deals_expiry` ON `deals` (`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `home_curations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`slot_type` text NOT NULL,
	`show_id` integer,
	`eyebrow` text,
	`title` text NOT NULL,
	`subtitle` text,
	`image_url` text,
	`link_url` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`starts_at` text,
	`ends_at` text,
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_curations_active` ON `home_curations` (`slot_type`,`is_active`,`sort_order`);--> statement-breakpoint
CREATE TABLE `ocr_image_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`show_id` integer,
	`source_channel` text NOT NULL,
	`source_page_url` text NOT NULL,
	`image_url` text NOT NULL,
	`image_hash` text,
	`ocr_status` text DEFAULT 'QUEUED' NOT NULL,
	`extracted_json` text,
	`confidence` real,
	`error_message` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ocr_image_jobs_image_url_unique` ON `ocr_image_jobs` (`image_url`);--> statement-breakpoint
CREATE INDEX `idx_ocr_hash` ON `ocr_image_jobs` (`image_hash`);--> statement-breakpoint
CREATE INDEX `idx_ocr_status` ON `ocr_image_jobs` (`ocr_status`,`created_at`);--> statement-breakpoint
CREATE TABLE `outbound_clicks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`deal_id` integer NOT NULL,
	`show_id` integer NOT NULL,
	`channel_name` text NOT NULL,
	`source_type` text NOT NULL,
	`session_hash` text NOT NULL,
	`clicked_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_clicks_dedup` ON `outbound_clicks` (`session_hash`,`deal_id`,`clicked_at`);--> statement-breakpoint
CREATE TABLE `show_actors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`show_id` integer NOT NULL,
	`actor_id` integer NOT NULL,
	`role_name` text,
	`source_type` text DEFAULT 'KOPIS' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `actors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uk_show_actors` ON `show_actors` (`show_id`,`actor_id`);--> statement-breakpoint
CREATE INDEX `idx_show_actors_actor` ON `show_actors` (`actor_id`,`show_id`);--> statement-breakpoint
CREATE TABLE `shows` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kopis_id` text,
	`title` text NOT NULL,
	`normalized_title` text NOT NULL,
	`poster_url` text,
	`venue_name` text NOT NULL,
	`venue_address` text,
	`region` text NOT NULL,
	`sub_region` text NOT NULL,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`base_prices_json` text,
	`min_active_price` integer,
	`max_discount_rate` integer,
	`status` text DEFAULT 'ONGOING' NOT NULL,
	`view_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `shows_kopis_id_unique` ON `shows` (`kopis_id`);--> statement-breakpoint
CREATE INDEX `idx_shows_4axis` ON `shows` (`status`,`sub_region`,`start_date`,`end_date`,`min_active_price`);--> statement-breakpoint
CREATE INDEX `idx_shows_norm_title` ON `shows` (`normalized_title`);--> statement-breakpoint
CREATE TABLE `sync_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source_name` text NOT NULL,
	`status` text NOT NULL,
	`fetched_count` integer DEFAULT 0 NOT NULL,
	`draft_count` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`started_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`finished_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_sync_runs_source` ON `sync_runs` (`source_name`,`started_at`);--> statement-breakpoint
CREATE TABLE `user_actor_follows` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`actor_id` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`actor_id`) REFERENCES `actors`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uk_follows_user_actor` ON `user_actor_follows` (`user_id`,`actor_id`);--> statement-breakpoint
CREATE TABLE `user_calendar_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`event_date` text NOT NULL,
	`event_time` text,
	`category` text NOT NULL,
	`title` text NOT NULL,
	`memo` text,
	`source_show_id` integer,
	`source_deal_id` integer,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`source_deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_cal_user_date` ON `user_calendar_events` (`user_id`,`event_date`);--> statement-breakpoint
CREATE TABLE `user_notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`noti_type` text NOT NULL,
	`show_id` integer,
	`deal_id` integer,
	`actor_id` integer,
	`report_id` integer,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`is_read` integer DEFAULT 0 NOT NULL,
	`is_saved` integer DEFAULT 0 NOT NULL,
	`dedup_key` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`deal_id`) REFERENCES `deals`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`actor_id`) REFERENCES `actors`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`report_id`) REFERENCES `deal_reports`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_notifications_dedup_key_unique` ON `user_notifications` (`dedup_key`);--> statement-breakpoint
CREATE INDEX `idx_noti_user_unread` ON `user_notifications` (`user_id`,`is_read`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_noti_story_target` ON `user_notifications` (`user_id`,`is_read`,`actor_id`,`show_id`);--> statement-breakpoint
CREATE INDEX `idx_noti_user_saved` ON `user_notifications` (`user_id`,`is_saved`,`created_at`);--> statement-breakpoint
CREATE TABLE `user_search_presets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`name` text NOT NULL,
	`query_params_json` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_presets_user` ON `user_search_presets` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `user_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`refresh_token_hash` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_sessions_refresh_token_hash_unique` ON `user_sessions` (`refresh_token_hash`);--> statement-breakpoint
CREATE TABLE `user_show_bookmarks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` integer NOT NULL,
	`show_id` integer NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`show_id`) REFERENCES `shows`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uk_bookmarks_user_show` ON `user_show_bookmarks` (`user_id`,`show_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`oauth_provider` text NOT NULL,
	`oauth_subject` text NOT NULL,
	`nickname` text NOT NULL,
	`email` text,
	`role` text DEFAULT 'USER' NOT NULL,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`terms_agreed_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uk_users_oauth` ON `users` (`oauth_provider`,`oauth_subject`);