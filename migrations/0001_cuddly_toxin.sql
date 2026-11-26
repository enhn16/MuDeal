ALTER TABLE `actors` ADD `external_playdb_id` text;--> statement-breakpoint
ALTER TABLE `actors` ADD `profile_image_url` text;--> statement-breakpoint
CREATE UNIQUE INDEX `actors_external_playdb_id_unique` ON `actors` (`external_playdb_id`);--> statement-breakpoint
ALTER TABLE `shows` ADD `synopsis` text;--> statement-breakpoint
ALTER TABLE `shows` ADD `synopsis_image_url` text;--> statement-breakpoint
ALTER TABLE `shows` ADD `channel_links_json` text;