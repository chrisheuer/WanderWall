CREATE TABLE IF NOT EXISTS "notification_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"dedupe_key" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_log_dedupe_key_unique" UNIQUE("dedupe_key")
);
--> statement-breakpoint
ALTER TABLE "galleries" ADD COLUMN "pending_checkout_session_id" text;--> statement-breakpoint
ALTER TABLE "galleries" ADD COLUMN "pending_checkout_expires_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "artworks_gallery_source_ref_idx" ON "artworks" USING btree ("gallery_id","source_ref") WHERE "artworks"."source_ref" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "purchases_one_creation_per_gallery_idx" ON "purchases" USING btree ("gallery_id") WHERE "purchases"."kind" in ('creation', 'annual_bundle');