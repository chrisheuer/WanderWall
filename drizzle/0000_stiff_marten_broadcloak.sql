CREATE TYPE "public"."featured_status" AS ENUM('pending', 'approved', 'declined');--> statement-breakpoint
CREATE TYPE "public"."gallery_status" AS ENUM('draft', 'published', 'unlisted', 'frozen', 'readonly');--> statement-breakpoint
CREATE TYPE "public"."hang_density" AS ENUM('salon', 'standard', 'airy');--> statement-breakpoint
CREATE TYPE "public"."license" AS ENUM('all-rights-reserved', 'cc-by', 'cc-by-sa', 'cc-by-nc', 'cc-by-nc-sa', 'cc-by-nd', 'cc-by-nc-nd', 'cc0');--> statement-breakpoint
CREATE TYPE "public"."purchase_kind" AS ENUM('creation', 'download', 'annual_bundle');--> statement-breakpoint
CREATE TYPE "public"."artwork_source_type" AS ENUM('upload', 'url', 'gdrive', 'dropbox');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'past_due', 'canceled', 'incomplete', 'trialing', 'unpaid');--> statement-breakpoint
CREATE TYPE "public"."gallery_tier" AS ENUM('S', 'L', 'download');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "artworks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gallery_id" uuid NOT NULL,
	"room_id" uuid,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"title" text DEFAULT 'Untitled' NOT NULL,
	"caption" text DEFAULT '' NOT NULL,
	"source_type" "artwork_source_type" DEFAULT 'upload' NOT NULL,
	"source_ref" text,
	"original_key" text,
	"derivative_keys" jsonb,
	"width_px" integer,
	"height_px" integer,
	"dominant_colors" jsonb,
	"exif" jsonb,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"frame_style_override" text,
	"license_override" "license",
	"spotlight" boolean DEFAULT false NOT NULL,
	"hero" boolean DEFAULT false NOT NULL,
	"ingest_status" text DEFAULT 'pending' NOT NULL,
	"ingest_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "creators" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"bio" text DEFAULT '' NOT NULL,
	"stripe_customer_id" text,
	"stripe_account_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creators_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "donations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gallery_id" uuid NOT NULL,
	"stripe_checkout_session_id" text,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"donor_name" text,
	"donor_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "donations_stripe_checkout_session_id_unique" UNIQUE("stripe_checkout_session_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "environments" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "featured_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gallery_id" uuid NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"status" "featured_status" DEFAULT 'pending' NOT NULL,
	"reviewed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "galleries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"statement" text DEFAULT '' NOT NULL,
	"tier" "gallery_tier" DEFAULT 'S' NOT NULL,
	"status" "gallery_status" DEFAULT 'draft' NOT NULL,
	"edit_window_expires_at" timestamp with time zone,
	"environment_archetype" text DEFAULT 'white-cube' NOT NULL,
	"environment_params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"frame_style_default" text DEFAULT 'thin-black-metal' NOT NULL,
	"lighting_default" text DEFAULT 'bright-daylight' NOT NULL,
	"hang_density" "hang_density" DEFAULT 'standard' NOT NULL,
	"license_default" "license" DEFAULT 'all-rights-reserved' NOT NULL,
	"featured" boolean DEFAULT false NOT NULL,
	"ownership_attested_at" timestamp with time zone,
	"export_donation_url" text,
	"last_export_key" text,
	"last_export_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "gallery_visits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gallery_id" uuid NOT NULL,
	"visitor_hash" text NOT NULL,
	"duration_seconds" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "import_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gallery_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"folder_ref" text NOT NULL,
	"cursor" text,
	"total_files" integer,
	"processed_files" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "oauth_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"gallery_id" uuid,
	"kind" "purchase_kind" NOT NULL,
	"stripe_checkout_session_id" text,
	"stripe_payment_intent_id" text,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'usd' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchases_stripe_checkout_session_id_unique" UNIQUE("stripe_checkout_session_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "rooms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gallery_id" uuid NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"archetype" text DEFAULT 'white-cube' NOT NULL,
	"footprint_m2" real DEFAULT 64 NOT NULL,
	"ceiling_m" real DEFAULT 4 NOT NULL,
	"wall_color" text DEFAULT '#f5f4f0' NOT NULL,
	"floor_material" text DEFAULT 'oak' NOT NULL,
	"lighting_rig" text DEFAULT 'bright-daylight' NOT NULL,
	"name" text,
	"chapter_label" text,
	"kind" text DEFAULT 'room' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"creator_id" uuid NOT NULL,
	"gallery_id" uuid,
	"stripe_subscription_id" text NOT NULL,
	"stripe_price_id" text NOT NULL,
	"status" "subscription_status" NOT NULL,
	"interval" text DEFAULT 'month' NOT NULL,
	"current_period_end" timestamp with time zone,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_stripe_subscription_id_unique" UNIQUE("stripe_subscription_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "artworks" ADD CONSTRAINT "artworks_gallery_id_galleries_id_fk" FOREIGN KEY ("gallery_id") REFERENCES "public"."galleries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "artworks" ADD CONSTRAINT "artworks_room_id_rooms_id_fk" FOREIGN KEY ("room_id") REFERENCES "public"."rooms"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "donations" ADD CONSTRAINT "donations_gallery_id_galleries_id_fk" FOREIGN KEY ("gallery_id") REFERENCES "public"."galleries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "featured_submissions" ADD CONSTRAINT "featured_submissions_gallery_id_galleries_id_fk" FOREIGN KEY ("gallery_id") REFERENCES "public"."galleries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "galleries" ADD CONSTRAINT "galleries_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "galleries" ADD CONSTRAINT "galleries_environment_archetype_environments_id_fk" FOREIGN KEY ("environment_archetype") REFERENCES "public"."environments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "gallery_visits" ADD CONSTRAINT "gallery_visits_gallery_id_galleries_id_fk" FOREIGN KEY ("gallery_id") REFERENCES "public"."galleries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_gallery_id_galleries_id_fk" FOREIGN KEY ("gallery_id") REFERENCES "public"."galleries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "oauth_tokens" ADD CONSTRAINT "oauth_tokens_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchases" ADD CONSTRAINT "purchases_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "purchases" ADD CONSTRAINT "purchases_gallery_id_galleries_id_fk" FOREIGN KEY ("gallery_id") REFERENCES "public"."galleries"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "rooms" ADD CONSTRAINT "rooms_gallery_id_galleries_id_fk" FOREIGN KEY ("gallery_id") REFERENCES "public"."galleries"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_creator_id_creators_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."creators"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_gallery_id_galleries_id_fk" FOREIGN KEY ("gallery_id") REFERENCES "public"."galleries"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artworks_gallery_idx" ON "artworks" USING btree ("gallery_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "artworks_room_idx" ON "artworks" USING btree ("room_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "galleries_slug_idx" ON "galleries" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "galleries_creator_idx" ON "galleries" USING btree ("creator_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "visits_gallery_idx" ON "gallery_visits" USING btree ("gallery_id","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "rooms_gallery_idx" ON "rooms" USING btree ("gallery_id");