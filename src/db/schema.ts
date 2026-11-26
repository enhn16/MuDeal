import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const nowIso = () => sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`;

export const SUB_REGIONS = [
  "DAEHAKRO",
  "SEOUL_OTHER",
  "GYEONGGI_INCHEON",
  "BUSAN",
  "DAEGU",
  "DAEJEON_CHUNGCHEONG",
  "GWANGJU_JEOLLA",
  "GANGWON_JEJU",
] as const;

export type SubRegion = (typeof SUB_REGIONS)[number];

export const DEAL_TYPES = [
  "TIMESALE",
  "LOTTERY",
  "DISCOUNT_SITE",
  "CARD_EVENT",
  "SPECIAL_DAY",
  "SINGALONG",
  "CURTAIN_CALL",
  "PERK_GOODS",
] as const;

export type DealType = (typeof DEAL_TYPES)[number];

export const SEAT_GRADES = ["VIP", "R", "S", "A", "ALL"] as const;
export type SeatGrade = (typeof SEAT_GRADES)[number];

export const CONDITION_TAGS = [
  "MATINEE",
  "REWATCH",
  "YOUTH_STUDENT",
  "OFFICE_WORKER",
  "CARD_PARTNER",
] as const;
export type ConditionTag = (typeof CONDITION_TAGS)[number];

// 1. users
export const users = sqliteTable(
  "users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    oauthProvider: text("oauth_provider", { enum: ["KAKAO", "GOOGLE"] }).notNull(),
    oauthSubject: text("oauth_subject").notNull(),
    nickname: text("nickname").notNull(),
    email: text("email"),
    role: text("role", { enum: ["USER", "ADMIN"] }).notNull().default("USER"),
    status: text("status", { enum: ["ACTIVE", "SUSPENDED", "WITHDRAWN"] }).notNull().default("ACTIVE"),
    termsAgreedAt: text("terms_agreed_at").notNull(),
    createdAt: text("created_at").notNull().default(nowIso()),
    updatedAt: text("updated_at").notNull().default(nowIso()),
  },
  (t) => [uniqueIndex("uk_users_oauth").on(t.oauthProvider, t.oauthSubject)],
);

// 2. user_sessions
export const userSessions = sqliteTable("user_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  refreshTokenHash: text("refresh_token_hash").notNull().unique(),
  expiresAt: text("expires_at").notNull(),
  revokedAt: text("revoked_at"),
  createdAt: text("created_at").notNull().default(nowIso()),
});

// 3. shows
export const shows = sqliteTable(
  "shows",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    kopisId: text("kopis_id").unique(),
    title: text("title").notNull(),
    normalizedTitle: text("normalized_title").notNull(),
    posterUrl: text("poster_url"),
    venueName: text("venue_name").notNull(),
    venueAddress: text("venue_address"),
    region: text("region").notNull(),
    subRegion: text("sub_region", { enum: SUB_REGIONS }).notNull(),
    startDate: text("start_date").notNull(), // YYYY-MM-DD (KST)
    endDate: text("end_date").notNull(), // YYYY-MM-DD (KST)
    basePricesJson: text("base_prices_json"),
    minActivePrice: integer("min_active_price"),
    maxDiscountRate: integer("max_discount_rate"),
    status: text("status", { enum: ["UPCOMING", "ONGOING", "ENDED"] }).notNull().default("ONGOING"),
    viewCount: integer("view_count").notNull().default(0),
    createdAt: text("created_at").notNull().default(nowIso()),
    updatedAt: text("updated_at").notNull().default(nowIso()),
  },
  (t) => [
    index("idx_shows_4axis").on(t.status, t.subRegion, t.startDate, t.endDate, t.minActivePrice),
    index("idx_shows_norm_title").on(t.normalizedTitle),
  ],
);

// 4. actors
export const actors = sqliteTable(
  "actors",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    disambiguationNote: text("disambiguation_note"),
    followerCount: integer("follower_count").notNull().default(0),
    createdAt: text("created_at").notNull().default(nowIso()),
    updatedAt: text("updated_at").notNull().default(nowIso()),
  },
  (t) => [index("idx_actors_norm_name").on(t.normalizedName)],
);

// 5. show_actors
export const showActors = sqliteTable(
  "show_actors",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    showId: integer("show_id")
      .notNull()
      .references(() => shows.id, { onDelete: "cascade" }),
    actorId: integer("actor_id")
      .notNull()
      .references(() => actors.id, { onDelete: "cascade" }),
    roleName: text("role_name"),
    sourceType: text("source_type", { enum: ["KOPIS", "ADMIN"] }).notNull().default("KOPIS"),
    createdAt: text("created_at").notNull().default(nowIso()),
  },
  (t) => [
    uniqueIndex("uk_show_actors").on(t.showId, t.actorId),
    index("idx_show_actors_actor").on(t.actorId, t.showId),
  ],
);

// 6. deal_reports
export const dealReports = sqliteTable(
  "deal_reports",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    reporterId: integer("reporter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reporterNickname: text("reporter_nickname").notNull(),
    showId: integer("show_id").references(() => shows.id, { onDelete: "set null" }),
    reportedShowTitle: text("reported_show_title").notNull(),
    channelName: text("channel_name").notNull(),
    externalUrl: text("external_url").notNull(),
    dealType: text("deal_type", { enum: DEAL_TYPES }).notNull(),
    seatGrade: text("seat_grade", { enum: SEAT_GRADES }).notNull().default("ALL"),
    reportedPrice: integer("reported_price"),
    reportedDiscountRate: integer("reported_discount_rate"),
    isUnconditional: integer("is_unconditional").notNull().default(1),
    conditionNote: text("condition_note"),
    expiresAt: text("expires_at"),
    evidenceR2Key: text("evidence_r2_key"),
    status: text("status", { enum: ["PENDING", "APPROVED", "REJECTED"] }).notNull().default("PENDING"),
    reviewerId: integer("reviewer_id").references(() => users.id, { onDelete: "set null" }),
    rejectReasonCode: text("reject_reason_code"),
    rejectReasonNote: text("reject_reason_note"),
    reviewedAt: text("reviewed_at"),
    createdAt: text("created_at").notNull().default(nowIso()),
    updatedAt: text("updated_at").notNull().default(nowIso()),
  },
  (t) => [
    index("idx_reports_status").on(t.status, t.createdAt),
    index("idx_reports_reporter").on(t.reporterId, t.createdAt),
  ],
);

// 7. ocr_image_jobs
export const ocrImageJobs = sqliteTable(
  "ocr_image_jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    showId: integer("show_id").references(() => shows.id, { onDelete: "set null" }),
    sourceChannel: text("source_channel").notNull(),
    sourcePageUrl: text("source_page_url").notNull(),
    imageUrl: text("image_url").notNull().unique(),
    imageHash: text("image_hash"),
    ocrStatus: text("ocr_status", { enum: ["QUEUED", "PROCESSING", "DONE", "NEEDS_REVIEW", "FAILED"] })
      .notNull()
      .default("QUEUED"),
    extractedJson: text("extracted_json"),
    confidence: real("confidence"),
    errorMessage: text("error_message"),
    createdAt: text("created_at").notNull().default(nowIso()),
    updatedAt: text("updated_at").notNull().default(nowIso()),
  },
  (t) => [
    index("idx_ocr_hash").on(t.imageHash),
    index("idx_ocr_status").on(t.ocrStatus, t.createdAt),
  ],
);

// 8. deals (showId nullable only while DRAFT awaits admin show matching)
export const deals = sqliteTable(
  "deals",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    showId: integer("show_id").references(() => shows.id, { onDelete: "cascade" }),
    channelName: text("channel_name").notNull(),
    dealType: text("deal_type", { enum: DEAL_TYPES }).notNull(),
    seatGrade: text("seat_grade", { enum: SEAT_GRADES }).notNull().default("ALL"),
    basePrice: integer("base_price"),
    salePrice: integer("sale_price"),
    discountRate: integer("discount_rate"),
    isUnconditional: integer("is_unconditional").notNull().default(1),
    conditionTagsJson: text("condition_tags_json"),
    conditionSummary: text("condition_summary"),
    opensAt: text("opens_at"),
    eventDatesJson: text("event_dates_json"),
    perkSummary: text("perk_summary"),
    feeInfo: text("fee_info"),
    externalUrl: text("external_url").notNull(),
    externalKey: text("external_key").unique(),
    expiresAt: text("expires_at"),
    status: text("status", { enum: ["DRAFT", "ACTIVE", "EXPIRED", "HIDDEN", "DISCARDED"] })
      .notNull()
      .default("DRAFT"),
    sourceType: text("source_type", { enum: ["SYNC_APPROVED", "OCR_APPROVED", "ADMIN", "USER_REPORT"] }).notNull(),
    sourceReportId: integer("source_report_id")
      .unique()
      .references(() => dealReports.id, { onDelete: "set null" }),
    sourceOcrJobId: integer("source_ocr_job_id").references(() => ocrImageJobs.id, { onDelete: "set null" }),
    reporterNickname: text("reporter_nickname"),
    clickCount: integer("click_count").notNull().default(0),
    helpfulCount: integer("helpful_count").notNull().default(0),
    adminLocked: integer("admin_locked").notNull().default(0),
    lastVerifiedAt: text("last_verified_at").notNull().default(nowIso()),
    createdAt: text("created_at").notNull().default(nowIso()),
    updatedAt: text("updated_at").notNull().default(nowIso()),
  },
  (t) => [
    index("idx_deals_compare").on(t.showId, t.status, t.seatGrade, t.salePrice, t.isUnconditional),
    index("idx_deals_community").on(t.sourceType, t.status, t.createdAt),
    index("idx_deals_price_filter").on(t.status, t.salePrice, t.isUnconditional),
    index("idx_deals_drafts").on(t.status, t.createdAt),
    index("idx_deals_expiry").on(t.status, t.expiresAt),
  ],
);

// 9. user_show_bookmarks
export const userShowBookmarks = sqliteTable(
  "user_show_bookmarks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    showId: integer("show_id")
      .notNull()
      .references(() => shows.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull().default(nowIso()),
  },
  (t) => [uniqueIndex("uk_bookmarks_user_show").on(t.userId, t.showId)],
);

// 10. user_actor_follows
export const userActorFollows = sqliteTable(
  "user_actor_follows",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    actorId: integer("actor_id")
      .notNull()
      .references(() => actors.id, { onDelete: "cascade" }),
    createdAt: text("created_at").notNull().default(nowIso()),
  },
  (t) => [uniqueIndex("uk_follows_user_actor").on(t.userId, t.actorId)],
);

// 11. user_notifications
export const userNotifications = sqliteTable(
  "user_notifications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    notiType: text("noti_type", {
      enum: [
        "BOOKMARKED_SHOW_DEAL",
        "FOLLOWED_ACTOR_DEAL",
        "FOLLOWED_ACTOR_NEW_SHOW",
        "REPORT_APPROVED",
        "REPORT_REJECTED",
      ],
    }).notNull(),
    showId: integer("show_id").references(() => shows.id, { onDelete: "set null" }),
    dealId: integer("deal_id").references(() => deals.id, { onDelete: "set null" }),
    actorId: integer("actor_id").references(() => actors.id, { onDelete: "set null" }),
    reportId: integer("report_id").references(() => dealReports.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    isRead: integer("is_read").notNull().default(0),
    isSaved: integer("is_saved").notNull().default(0),
    dedupKey: text("dedup_key").notNull().unique(),
    createdAt: text("created_at").notNull().default(nowIso()),
  },
  (t) => [
    index("idx_noti_user_unread").on(t.userId, t.isRead, t.createdAt),
    index("idx_noti_story_target").on(t.userId, t.isRead, t.actorId, t.showId),
    index("idx_noti_user_saved").on(t.userId, t.isSaved, t.createdAt),
  ],
);

// 12. user_calendar_events
export const userCalendarEvents = sqliteTable(
  "user_calendar_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventDate: text("event_date").notNull(), // YYYY-MM-DD (KST)
    eventTime: text("event_time"), // HH:mm
    category: text("category", { enum: ["WATCH", "TICKETING", "EVENT", "CUSTOM"] }).notNull(),
    title: text("title").notNull(),
    memo: text("memo"),
    sourceShowId: integer("source_show_id").references(() => shows.id, { onDelete: "set null" }),
    sourceDealId: integer("source_deal_id").references(() => deals.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull().default(nowIso()),
    updatedAt: text("updated_at").notNull().default(nowIso()),
  },
  (t) => [index("idx_cal_user_date").on(t.userId, t.eventDate)],
);

// 13. user_search_presets
export const userSearchPresets = sqliteTable(
  "user_search_presets",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    queryParamsJson: text("query_params_json").notNull(),
    createdAt: text("created_at").notNull().default(nowIso()),
  },
  (t) => [index("idx_presets_user").on(t.userId, t.createdAt)],
);

// 14. deal_helpful_votes
export const dealHelpfulVotes = sqliteTable(
  "deal_helpful_votes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    dealId: integer("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    userId: integer("user_id").references(() => users.id, { onDelete: "cascade" }),
    sessionHash: text("session_hash"),
    createdAt: text("created_at").notNull().default(nowIso()),
  },
  (t) => [
    uniqueIndex("uk_helpful_user").on(t.dealId, t.userId),
    uniqueIndex("uk_helpful_sess").on(t.dealId, t.sessionHash),
  ],
);

// 15. deal_issues
export const dealIssues = sqliteTable(
  "deal_issues",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    dealId: integer("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    reporterId: integer("reporter_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    issueType: text("issue_type", { enum: ["SOLD_OUT", "PRICE_MISMATCH", "BROKEN_LINK", "ENDED", "OTHER"] }).notNull(),
    note: text("note"),
    status: text("status", { enum: ["OPEN", "RESOLVED", "DISMISSED"] }).notNull().default("OPEN"),
    resolvedBy: integer("resolved_by").references(() => users.id, { onDelete: "set null" }),
    resolvedAt: text("resolved_at"),
    createdAt: text("created_at").notNull().default(nowIso()),
    updatedAt: text("updated_at").notNull().default(nowIso()),
  },
  (t) => [index("idx_issues_status").on(t.status, t.createdAt)],
);

// 16. home_curations
export const homeCurations = sqliteTable(
  "home_curations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    slotType: text("slot_type", { enum: ["HERO", "SPOTLIGHT"] }).notNull(),
    showId: integer("show_id").references(() => shows.id, { onDelete: "set null" }),
    eyebrow: text("eyebrow"),
    title: text("title").notNull(),
    subtitle: text("subtitle"),
    imageUrl: text("image_url"),
    linkUrl: text("link_url").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    startsAt: text("starts_at"),
    endsAt: text("ends_at"),
    isActive: integer("is_active").notNull().default(1),
    createdAt: text("created_at").notNull().default(nowIso()),
    updatedAt: text("updated_at").notNull().default(nowIso()),
  },
  (t) => [index("idx_curations_active").on(t.slotType, t.isActive, t.sortOrder)],
);

// 17. outbound_clicks
export const outboundClicks = sqliteTable(
  "outbound_clicks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    dealId: integer("deal_id")
      .notNull()
      .references(() => deals.id, { onDelete: "cascade" }),
    showId: integer("show_id")
      .notNull()
      .references(() => shows.id, { onDelete: "cascade" }),
    channelName: text("channel_name").notNull(),
    sourceType: text("source_type").notNull(),
    sessionHash: text("session_hash").notNull(),
    clickedAt: text("clicked_at").notNull().default(nowIso()),
  },
  (t) => [index("idx_clicks_dedup").on(t.sessionHash, t.dealId, t.clickedAt)],
);

// 18. sync_runs
export const syncRuns = sqliteTable(
  "sync_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceName: text("source_name").notNull(),
    status: text("status", { enum: ["RUNNING", "SUCCESS", "FAILED"] }).notNull(),
    fetchedCount: integer("fetched_count").notNull().default(0),
    draftCount: integer("draft_count").notNull().default(0),
    errorMessage: text("error_message"),
    startedAt: text("started_at").notNull().default(nowIso()),
    finishedAt: text("finished_at"),
  },
  (t) => [index("idx_sync_runs_source").on(t.sourceName, t.startedAt)],
);

// 19. audit_logs
export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    actorUserId: integer("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    payloadJson: text("payload_json"),
    createdAt: text("created_at").notNull().default(nowIso()),
  },
  (t) => [index("idx_audit_target").on(t.targetType, t.targetId, t.createdAt)],
);
