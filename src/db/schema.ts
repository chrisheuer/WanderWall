import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  index,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const tierEnum = pgEnum("gallery_tier", ["S", "L", "download"]);

export const galleryStatusEnum = pgEnum("gallery_status", [
  "draft",
  "published",
  "unlisted",
  "frozen",
  "readonly",
]);

export const licenseEnum = pgEnum("license", [
  "all-rights-reserved",
  "cc-by",
  "cc-by-sa",
  "cc-by-nc",
  "cc-by-nc-sa",
  "cc-by-nd",
  "cc-by-nc-nd",
  "cc0",
]);

export const sourceTypeEnum = pgEnum("artwork_source_type", [
  "upload",
  "url",
  "gdrive",
  "dropbox",
]);

export const hangDensityEnum = pgEnum("hang_density", [
  "salon",
  "standard",
  "airy",
]);

export const featuredStatusEnum = pgEnum("featured_status", [
  "pending",
  "approved",
  "declined",
]);

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "active",
  "past_due",
  "canceled",
  "incomplete",
  "trialing",
  "unpaid",
]);

export const purchaseKindEnum = pgEnum("purchase_kind", [
  "creation",
  "download",
  "annual_bundle",
]);

// ---------------------------------------------------------------------------
// Creators — auth identity mirrors Supabase Auth users (id = auth.users.id)
// ---------------------------------------------------------------------------

export const creators = pgTable("creators", {
  id: uuid("id").primaryKey(), // = supabase auth user id
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull().default(""),
  bio: text("bio").notNull().default(""),
  stripeCustomerId: text("stripe_customer_id"),
  // Multi-tenant seam: Stripe Connect destination account. Null in v1 —
  // donations settle to the platform owner.
  stripeAccountId: text("stripe_account_id"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Environments — seeded archetype catalog
// ---------------------------------------------------------------------------

export const environments = pgTable("environments", {
  id: text("id").primaryKey(), // slug, e.g. "white-cube"
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  // Geometry kit + material palette + compatible lighting rigs + connectors.
  params: jsonb("params").notNull().default({}),
  sortOrder: integer("sort_order").notNull().default(0),
});

// ---------------------------------------------------------------------------
// Galleries
// ---------------------------------------------------------------------------

export const galleries = pgTable(
  "galleries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    creatorId: uuid("creator_id")
      .notNull()
      .references(() => creators.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    statement: text("statement").notNull().default(""),
    tier: tierEnum("tier").notNull().default("S"),
    status: galleryStatusEnum("status").notNull().default("draft"),
    // Download tier only: editing/re-export allowed until this instant.
    editWindowExpiresAt: timestamp("edit_window_expires_at", {
      withTimezone: true,
    }),
    environmentArchetype: text("environment_archetype")
      .notNull()
      .default("white-cube")
      .references(() => environments.id),
    environmentParams: jsonb("environment_params").notNull().default({}),
    frameStyleDefault: text("frame_style_default")
      .notNull()
      .default("thin-black-metal"),
    lightingDefault: text("lighting_default").notNull().default("bright-daylight"),
    hangDensity: hangDensityEnum("hang_density").notNull().default("standard"),
    licenseDefault: licenseEnum("license_default")
      .notNull()
      .default("all-rights-reserved"),
    featured: boolean("featured").notNull().default(false),
    // Set at publish: the creator attests they own/have rights to the works.
    ownershipAttestedAt: timestamp("ownership_attested_at", {
      withTimezone: true,
    }),
    // Optional creator-supplied Stripe Payment Link for static exports.
    exportDonationUrl: text("export_donation_url"),
    lastExportKey: text("last_export_key"),
    lastExportAt: timestamp("last_export_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("galleries_slug_idx").on(t.slug),
    index("galleries_creator_idx").on(t.creatorId),
  ],
);

// ---------------------------------------------------------------------------
// Rooms — every room is a config object, never a hardcoded scene
// ---------------------------------------------------------------------------

export const rooms = pgTable(
  "rooms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    galleryId: uuid("gallery_id")
      .notNull()
      .references(() => galleries.id, { onDelete: "cascade" }),
    sortOrder: integer("sort_order").notNull().default(0),
    archetype: text("archetype").notNull().default("white-cube"),
    footprintM2: real("footprint_m2").notNull().default(64),
    ceilingM: real("ceiling_m").notNull().default(4),
    wallColor: text("wall_color").notNull().default("#f5f4f0"),
    floorMaterial: text("floor_material").notNull().default("oak"),
    lightingRig: text("lighting_rig").notNull().default("bright-daylight"),
    name: text("name"),
    chapterLabel: text("chapter_label"),
    // Pacing primitives: corridors and courtyards are rooms with a kind.
    kind: text("kind").notNull().default("room"), // room | corridor | courtyard
  },
  (t) => [index("rooms_gallery_idx").on(t.galleryId)],
);

// ---------------------------------------------------------------------------
// Artworks
// ---------------------------------------------------------------------------

export const artworks = pgTable(
  "artworks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    galleryId: uuid("gallery_id")
      .notNull()
      .references(() => galleries.id, { onDelete: "cascade" }),
    roomId: uuid("room_id").references(() => rooms.id, {
      onDelete: "set null",
    }),
    sortOrder: integer("sort_order").notNull().default(0),
    title: text("title").notNull().default("Untitled"),
    caption: text("caption").notNull().default(""),
    sourceType: sourceTypeEnum("source_type").notNull().default("upload"),
    sourceRef: text("source_ref"), // original URL / drive file id / dropbox path
    originalKey: text("original_key"),
    // { thumb: key, wall: key, zoom: key } — WebP at 256 / 1024 / 2048.
    derivativeKeys: jsonb("derivative_keys").$type<Record<string, string>>(),
    widthPx: integer("width_px"),
    heightPx: integer("height_px"),
    dominantColors: jsonb("dominant_colors").$type<string[]>(),
    // Full EXIF retained privately for the creator; GPS stripped from
    // everything served publicly.
    exif: jsonb("exif"),
    tags: jsonb("tags").$type<string[]>().default([]),
    frameStyleOverride: text("frame_style_override"),
    licenseOverride: licenseEnum("license_override"),
    spotlight: boolean("spotlight").notNull().default(false),
    hero: boolean("hero").notNull().default(false),
    ingestStatus: text("ingest_status").notNull().default("pending"), // pending | processing | ready | failed
    ingestError: text("ingest_error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("artworks_gallery_idx").on(t.galleryId),
    index("artworks_room_idx").on(t.roomId),
  ],
);

// ---------------------------------------------------------------------------
// Commerce — Stripe-mirrored, webhook-driven
// ---------------------------------------------------------------------------

export const purchases = pgTable("purchases", {
  id: uuid("id").primaryKey().defaultRandom(),
  creatorId: uuid("creator_id")
    .notNull()
    .references(() => creators.id),
  galleryId: uuid("gallery_id").references(() => galleries.id, {
    onDelete: "set null",
  }),
  kind: purchaseKindEnum("kind").notNull(),
  stripeCheckoutSessionId: text("stripe_checkout_session_id").unique(),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull().default("usd"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const subscriptions = pgTable("subscriptions", {
  id: uuid("id").primaryKey().defaultRandom(),
  creatorId: uuid("creator_id")
    .notNull()
    .references(() => creators.id),
  galleryId: uuid("gallery_id").references(() => galleries.id, {
    onDelete: "set null",
  }),
  stripeSubscriptionId: text("stripe_subscription_id").notNull().unique(),
  stripePriceId: text("stripe_price_id").notNull(),
  status: subscriptionStatusEnum("status").notNull(),
  interval: text("interval").notNull().default("month"), // month | year
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const donations = pgTable("donations", {
  id: uuid("id").primaryKey().defaultRandom(),
  galleryId: uuid("gallery_id")
    .notNull()
    .references(() => galleries.id, { onDelete: "cascade" }),
  stripeCheckoutSessionId: text("stripe_checkout_session_id").unique(),
  amountCents: integer("amount_cents").notNull(),
  currency: text("currency").notNull().default("usd"),
  donorName: text("donor_name"),
  donorMessage: text("donor_message"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Featured program
// ---------------------------------------------------------------------------

export const featuredSubmissions = pgTable("featured_submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  galleryId: uuid("gallery_id")
    .notNull()
    .references(() => galleries.id, { onDelete: "cascade" }),
  note: text("note").notNull().default(""),
  status: featuredStatusEnum("status").notNull().default("pending"),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// Cloud import runs — chunked, resumable
// ---------------------------------------------------------------------------

export const importRuns = pgTable("import_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  galleryId: uuid("gallery_id")
    .notNull()
    .references(() => galleries.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(), // gdrive | dropbox
  folderRef: text("folder_ref").notNull(),
  cursor: text("cursor"), // provider pagination cursor for resume
  totalFiles: integer("total_files"),
  processedFiles: integer("processed_files").notNull().default(0),
  status: text("status").notNull().default("running"), // running | done | failed | canceled
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ---------------------------------------------------------------------------
// First-party analytics — no third parties
// ---------------------------------------------------------------------------

export const galleryVisits = pgTable(
  "gallery_visits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    galleryId: uuid("gallery_id")
      .notNull()
      .references(() => galleries.id, { onDelete: "cascade" }),
    // Daily-rotating hash of ip+ua — uniques without storing identifiers.
    visitorHash: text("visitor_hash").notNull(),
    durationSeconds: integer("duration_seconds"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("visits_gallery_idx").on(t.galleryId, t.createdAt)],
);

// pg-boss manages its own `pgboss` schema for the jobs table.

export const oauthTokens = pgTable("oauth_tokens", {
  id: uuid("id").primaryKey().defaultRandom(),
  creatorId: uuid("creator_id")
    .notNull()
    .references(() => creators.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(), // gdrive | dropbox
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
