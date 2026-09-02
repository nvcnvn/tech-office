--
-- PostgreSQL database dump
--



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: assets; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA assets;


--
-- Name: calendar; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA calendar;


--
-- Name: chat; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA chat;


--
-- Name: collaboration; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA collaboration;


--
-- Name: communication; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA communication;


--
-- Name: compliance; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA compliance;


--
-- Name: crm; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA crm;


--
-- Name: docs; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA docs;


--
-- Name: files; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA files;


--
-- Name: finance; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA finance;


--
-- Name: flows; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA flows;


--
-- Name: hiring; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA hiring;


--
-- Name: iam; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA iam;


--
-- Name: integrations; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA integrations;


--
-- Name: inventory; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA inventory;


--
-- Name: learning; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA learning;


--
-- Name: notification; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA notification;


--
-- Name: organization; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA organization;


--
-- Name: payroll; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA payroll;


--
-- Name: procurement; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA procurement;


--
-- Name: retention; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA retention;


--
-- Name: support; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA support;


--
-- Name: timekeeping; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA timekeeping;


--
-- Name: voice; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA voice;


--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: pgroonga; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgroonga WITH SCHEMA public;


--
-- Name: EXTENSION pgroonga; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgroonga IS 'Super fast and all languages supported full text search index based on Groonga';


--
-- Name: unaccent; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;


--
-- Name: EXTENSION unaccent; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION unaccent IS 'text search dictionary that removes accents';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: attendee; Type: TABLE; Schema: calendar; Owner: -
--

CREATE TABLE calendar.attendee (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    event_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    role text DEFAULT 'required'::text NOT NULL,
    rsvp_status text DEFAULT 'pending'::text NOT NULL,
    response_time timestamp with time zone,
    response_note text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT attendee_role_check CHECK ((role = ANY (ARRAY['required'::text, 'optional'::text, 'organizer'::text]))),
    CONSTRAINT attendee_rsvp_status_check CHECK ((rsvp_status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text, 'tentative'::text])))
);


--
-- Name: audit_entry; Type: TABLE; Schema: calendar; Owner: -
--

CREATE TABLE calendar.audit_entry (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    event_id uuid NOT NULL,
    actor_id uuid NOT NULL,
    delegate_id uuid,
    action_type text NOT NULL,
    diff_snapshot jsonb DEFAULT '{}'::jsonb NOT NULL,
    occurred_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT audit_entry_action_type_check CHECK ((action_type = ANY (ARRAY['created'::text, 'modified'::text, 'cancelled'::text, 'checked_in'::text, 'evidence_submitted'::text, 'acknowledged'::text, 'flagged_unacknowledged'::text, 'series_forked'::text, 'instance_skipped'::text])))
);


--
-- Name: TABLE audit_entry; Type: COMMENT; Schema: calendar; Owner: -
--

COMMENT ON TABLE calendar.audit_entry IS 'Append-only compliance audit trail. NEVER delete or update rows — insert only.';


--
-- Name: booking_link; Type: TABLE; Schema: calendar; Owner: -
--

CREATE TABLE calendar.booking_link (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    token text NOT NULL,
    title text NOT NULL,
    duration_minutes integer NOT NULL,
    available_windows jsonb DEFAULT '[]'::jsonb NOT NULL,
    valid_from date NOT NULL,
    valid_until date NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    claimed_event_id uuid,
    claimed_by_id uuid,
    claimed_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT booking_link_status_check CHECK ((status = ANY (ARRAY['active'::text, 'expired'::text, 'claimed'::text])))
);


--
-- Name: check_in; Type: TABLE; Schema: calendar; Owner: -
--

CREATE TABLE calendar.check_in (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    event_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    checked_in_at timestamp with time zone NOT NULL,
    is_late boolean DEFAULT false NOT NULL,
    evidence_file_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    submitted_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: delegation; Type: TABLE; Schema: calendar; Owner: -
--

CREATE TABLE calendar.delegation (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    owner_id uuid NOT NULL,
    delegate_id uuid NOT NULL,
    can_create boolean DEFAULT true NOT NULL,
    can_modify boolean DEFAULT true NOT NULL,
    can_cancel boolean DEFAULT true NOT NULL,
    expires_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: event; Type: TABLE; Schema: calendar; Owner: -
--

CREATE TABLE calendar.event (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    event_type text NOT NULL,
    visibility text DEFAULT 'personal_shared'::text NOT NULL,
    start_time timestamp with time zone NOT NULL,
    end_time timestamp with time zone NOT NULL,
    all_day boolean DEFAULT false NOT NULL,
    location_text text,
    virtual_link text,
    organizer_id uuid NOT NULL,
    recurrence_rule text,
    recurrence_end timestamp with time zone,
    series_id uuid,
    is_exception_instance boolean DEFAULT false NOT NULL,
    original_start_time timestamp with time zone,
    description_document_id uuid,
    discussion_channel_id uuid,
    requires_check_in boolean DEFAULT false NOT NULL,
    requires_evidence boolean DEFAULT false NOT NULL,
    cancelled_at timestamp with time zone,
    cancelled_by_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_event_end_after_start CHECK (((end_time > start_time) OR (all_day = true))),
    CONSTRAINT event_event_type_check CHECK ((event_type = ANY (ARRAY['meeting'::text, 'shift'::text, 'deadline'::text, 'reminder'::text, 'out_of_office'::text, 'company_event'::text, 'training'::text, 'maintenance_window'::text]))),
    CONSTRAINT event_title_check CHECK (((char_length(title) >= 1) AND (char_length(title) <= 500))),
    CONSTRAINT event_visibility_check CHECK ((visibility = ANY (ARRAY['private'::text, 'personal_shared'::text, 'team'::text, 'org_wide'::text])))
);


--
-- Name: TABLE event; Type: COMMENT; Schema: calendar; Owner: -
--

COMMENT ON TABLE calendar.event IS 'Calendar events — one-time or recurring series head. Times stored UTC.';


--
-- Name: event_reminder; Type: TABLE; Schema: calendar; Owner: -
--

CREATE TABLE calendar.event_reminder (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    event_id uuid NOT NULL,
    attendee_employee_id uuid NOT NULL,
    reminder_offset_minutes integer DEFAULT 15 NOT NULL,
    fire_at timestamp with time zone NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT event_reminder_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'cancelled'::text])))
);


--
-- Name: TABLE event_reminder; Type: COMMENT; Schema: calendar; Owner: -
--

COMMENT ON TABLE calendar.event_reminder IS 'Staging table for CalendarReminderWorkflow. Workflow polls pending rows where fire_at <= now().';


--
-- Name: recurrence_exception; Type: TABLE; Schema: calendar; Owner: -
--

CREATE TABLE calendar.recurrence_exception (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    series_id uuid NOT NULL,
    original_start_time timestamp with time zone NOT NULL,
    exception_type text NOT NULL,
    new_event_id uuid,
    changed_by_id uuid NOT NULL,
    changed_at timestamp with time zone DEFAULT now() NOT NULL,
    change_scope text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT recurrence_exception_change_scope_check CHECK ((change_scope = ANY (ARRAY['this_instance'::text, 'this_and_following'::text, 'all'::text]))),
    CONSTRAINT recurrence_exception_exception_type_check CHECK ((exception_type = ANY (ARRAY['modified'::text, 'skipped'::text, 'cancelled'::text])))
);


--
-- Name: resource; Type: TABLE; Schema: calendar; Owner: -
--

CREATE TABLE calendar.resource (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    resource_type text NOT NULL,
    location text,
    capacity integer,
    is_active boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT resource_resource_type_check CHECK ((resource_type = ANY (ARRAY['room'::text, 'vehicle'::text, 'equipment'::text, 'desk'::text, 'lab'::text])))
);


--
-- Name: resource_acl; Type: TABLE; Schema: calendar; Owner: -
--

CREATE TABLE calendar.resource_acl (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    resource_id uuid NOT NULL,
    employee_id uuid,
    department_id uuid,
    can_book boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT chk_resource_acl_target CHECK ((((employee_id IS NOT NULL) AND (department_id IS NULL)) OR ((employee_id IS NULL) AND (department_id IS NOT NULL))))
);


--
-- Name: resource_booking; Type: TABLE; Schema: calendar; Owner: -
--

CREATE TABLE calendar.resource_booking (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    resource_id uuid NOT NULL,
    event_id uuid NOT NULL,
    start_time timestamp with time zone NOT NULL,
    end_time timestamp with time zone NOT NULL,
    booked_by_id uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: working_hours; Type: TABLE; Schema: calendar; Owner: -
--

CREATE TABLE calendar.working_hours (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    day_of_week integer NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone NOT NULL,
    is_working_day boolean DEFAULT true NOT NULL,
    timezone text DEFAULT 'UTC'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT working_hours_day_of_week_check CHECK (((day_of_week >= 1) AND (day_of_week <= 7)))
);


--
-- Name: channel; Type: TABLE; Schema: chat; Owner: -
--

CREATE TABLE chat.channel (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    title_slug text NOT NULL,
    display_name text NOT NULL,
    description text,
    channel_type text DEFAULT 'chat'::text NOT NULL,
    is_private boolean DEFAULT false NOT NULL,
    is_archived boolean DEFAULT false NOT NULL,
    created_by_employee_id uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT slug_format CHECK (((title_slug ~ '^[a-z0-9-]+$'::text) AND (length(title_slug) <= 64))),
    CONSTRAINT valid_channel_type CHECK ((channel_type = ANY (ARRAY['chat'::text, 'direct_message'::text, 'project_ticket_thread'::text, 'crm_deal_notes'::text, 'support_ticket'::text])))
);


--
-- Name: TABLE channel; Type: COMMENT; Schema: chat; Owner: -
--

COMMENT ON TABLE chat.channel IS 'Communication spaces (channels) where employees can send messages. Supports public/private channels, direct messages, and specialized types for reusability (project comments, CRM notes).';


--
-- Name: COLUMN channel.channel_type; Type: COMMENT; Schema: chat; Owner: -
--

COMMENT ON COLUMN chat.channel.channel_type IS 'Channel type: chat, direct_message, project_ticket_thread, crm_deal_notes, support_ticket. MUST align with backend constants in internal/chat/constants.go, proto enum rpc.v1.ChannelType, and frontend TypeScript types in packages/apis/src/chat.ts';


--
-- Name: channel_membership; Type: TABLE; Schema: chat; Owner: -
--

CREATE TABLE chat.channel_membership (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    channel_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    is_admin boolean DEFAULT false NOT NULL,
    notification_preference text DEFAULT 'all'::text NOT NULL,
    last_viewed_message_id uuid,
    last_viewed_at timestamp with time zone DEFAULT now(),
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT valid_notification_pref CHECK ((notification_preference = ANY (ARRAY['all'::text, 'mentions'::text, 'muted'::text])))
);


--
-- Name: TABLE channel_membership; Type: COMMENT; Schema: chat; Owner: -
--

COMMENT ON TABLE chat.channel_membership IS 'Tracks channel memberships, admin roles, and per-channel notification preferences. Used for access control and notification filtering.';


--
-- Name: COLUMN channel_membership.notification_preference; Type: COMMENT; Schema: chat; Owner: -
--

COMMENT ON COLUMN chat.channel_membership.notification_preference IS 'Per-channel notification preference: all, mentions, muted. MUST align with backend constants in internal/chat/constants.go, proto enum rpc.v1.NotificationPreference, and frontend TypeScript types in packages/apis/src/chat.ts';


--
-- Name: message; Type: TABLE; Schema: chat; Owner: -
--

CREATE TABLE chat.message (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    channel_id uuid NOT NULL,
    message_text text NOT NULL,
    author_employee_id uuid NOT NULL,
    parent_message_id uuid,
    is_deleted boolean DEFAULT false NOT NULL,
    is_edited boolean DEFAULT false NOT NULL,
    edit_history jsonb,
    mentions jsonb,
    file_ids uuid[],
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    message_kind text DEFAULT 'text'::text NOT NULL,
    system_event_type text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT message_kind_valid CHECK ((message_kind = ANY (ARRAY['text'::text, 'voice'::text, 'system'::text]))),
    CONSTRAINT message_metadata_object CHECK ((jsonb_typeof(metadata) = 'object'::text)),
    CONSTRAINT message_system_event_consistency CHECK ((((message_kind = 'system'::text) AND (system_event_type IS NOT NULL)) OR ((message_kind <> 'system'::text) AND (system_event_type IS NULL)))),
    CONSTRAINT message_system_event_type_valid CHECK (((system_event_type IS NULL) OR (system_event_type = ANY (ARRAY['voice_call_started'::text, 'voice_call_ended'::text, 'voice_call_missed'::text, 'voice_call_cancelled'::text, 'task_created_from_message'::text]))))
);


--
-- Name: TABLE message; Type: COMMENT; Schema: chat; Owner: -
--

COMMENT ON TABLE chat.message IS 'Messages and replies within channels. Supports 1-level threading (replies to messages only, no replies to replies), editing, soft deletion, rich text HTML formatting (server-side sanitized), voice messages, system call events, and multilingual full-text search via PGroonga (no language detection required).';


--
-- Name: COLUMN message.message_text; Type: COMMENT; Schema: chat; Owner: -
--

COMMENT ON COLUMN chat.message.message_text IS 'Message content as server-sanitized HTML. Allowed tags: <b>, <strong>, <i>, <em>, <u>, <code>, <pre>, <a href="">, <ul>, <ol>, <li>, <p>, <br>. Plaintext messages (no HTML tags) are valid HTML and render correctly. PGroonga automatically strips HTML tags during indexing for full-text search.';


--
-- Name: COLUMN message.message_kind; Type: COMMENT; Schema: chat; Owner: -
--

COMMENT ON COLUMN chat.message.message_kind IS 'Timeline message kind: text, voice, system. MUST align with backend constants in internal/chat/constants.go and frontend TypeScript types in packages/apis/src/chat.ts';


--
-- Name: COLUMN message.system_event_type; Type: COMMENT; Schema: chat; Owner: -
--

COMMENT ON COLUMN chat.message.system_event_type IS 'System event discriminator for system messages. Voice values MUST align with backend constants and frontend TypeScript types.';


--
-- Name: COLUMN message.metadata; Type: COMMENT; Schema: chat; Owner: -
--

COMMENT ON COLUMN chat.message.metadata IS 'Structured timeline metadata for voice messages, call records, and other system-rendered events.';


--
-- Name: reaction; Type: TABLE; Schema: chat; Owner: -
--

CREATE TABLE chat.reaction (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    message_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    emoji_code text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE reaction; Type: COMMENT; Schema: chat; Owner: -
--

COMMENT ON TABLE chat.reaction IS 'Emoji reactions to messages. Multiple employees can react with the same emoji (aggregated as counts). Duplicate reactions from same employee toggle (remove existing).';


--
-- Name: typing_indicator; Type: TABLE; Schema: chat; Owner: -
--

CREATE TABLE chat.typing_indicator (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    channel_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE typing_indicator; Type: COMMENT; Schema: chat; Owner: -
--

COMMENT ON TABLE chat.typing_indicator IS 'Tracks which employees are currently typing in channels. Ephemeral state with auto-cleanup. May use in-memory implementation in production to reduce database load.';


--
-- Name: user_chat_config; Type: TABLE; Schema: chat; Owner: -
--

CREATE TABLE chat.user_chat_config (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    channel_categories jsonb DEFAULT '{}'::jsonb NOT NULL,
    category_limits jsonb DEFAULT '{"archived": 10, "channels": 30, "direct_messages": 20}'::jsonb NOT NULL,
    pinned_channel_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    sidebar_category_collapsed jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE user_chat_config; Type: COMMENT; Schema: chat; Owner: -
--

COMMENT ON TABLE chat.user_chat_config IS 'Per-user chat preferences including visible channels (via channel_categories), pinned channels, per-category limits, and sidebar display state. Only channels present in channel_categories are visible in sidebar. Order is derived from channel.updated_at (most recent first).';


--
-- Name: COLUMN user_chat_config.channel_categories; Type: COMMENT; Schema: chat; Owner: -
--

COMMENT ON COLUMN chat.user_chat_config.channel_categories IS 'JSONB mapping of channel_id to category. Presence in this map makes channel visible in sidebar. Example: {"uuid-1": "channels", "uuid-2": "direct_messages"}. Categories: channels (public/private channels), direct_messages (1-on-1 DMs), archived (archived channels). Order within category determined by channel.updated_at DESC.';


--
-- Name: COLUMN user_chat_config.category_limits; Type: COMMENT; Schema: chat; Owner: -
--

COMMENT ON COLUMN chat.user_chat_config.category_limits IS 'JSONB object defining max visible channels per category. Example: {"channels": 30, "direct_messages": 20, "archived": 10}. When category exceeds limit, oldest channels (by updated_at) are automatically removed from channel_categories.';


--
-- Name: COLUMN user_chat_config.pinned_channel_ids; Type: COMMENT; Schema: chat; Owner: -
--

COMMENT ON COLUMN chat.user_chat_config.pinned_channel_ids IS 'Array of pinned channel IDs (subset of channel_categories keys). Pinned channels appear at top within their category, ordered by position in this array. Non-pinned channels follow, ordered by updated_at DESC.';


--
-- Name: COLUMN user_chat_config.sidebar_category_collapsed; Type: COMMENT; Schema: chat; Owner: -
--

COMMENT ON COLUMN chat.user_chat_config.sidebar_category_collapsed IS 'JSONB object tracking collapsed state of sidebar categories. Example: {"channels": false, "direct_messages": false}.';


--
-- Name: channel_task_destination; Type: TABLE; Schema: collaboration; Owner: -
--

CREATE TABLE collaboration.channel_task_destination (
    organization_id uuid NOT NULL,
    channel_id uuid NOT NULL,
    project_id uuid NOT NULL,
    set_by_employee_id uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE channel_task_destination; Type: COMMENT; Schema: collaboration; Owner: -
--

COMMENT ON TABLE collaboration.channel_task_destination IS 'The project that tasks created from a chat channel default to. Written by the first conversion in a channel and changeable only by a channel administrator; a per-conversion override never changes it.';


--
-- Name: COLUMN channel_task_destination.set_by_employee_id; Type: COMMENT; Schema: collaboration; Owner: -
--

COMMENT ON COLUMN collaboration.channel_task_destination.set_by_employee_id IS 'Who last set the destination. Shown when explaining where the pre-filled project came from.';


--
-- Name: custom_field_definition; Type: TABLE; Schema: collaboration; Owner: -
--

CREATE TABLE collaboration.custom_field_definition (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    field_type text NOT NULL,
    options jsonb,
    default_value jsonb,
    is_required boolean DEFAULT false NOT NULL,
    min_value numeric(10,2),
    max_value numeric(10,2),
    "position" integer DEFAULT 0 NOT NULL,
    is_archived boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT custom_field_definition_field_type_check CHECK ((field_type = ANY (ARRAY['text'::text, 'number'::text, 'single_select'::text, 'multi_select'::text, 'date'::text, 'user'::text, 'checkbox'::text])))
);


--
-- Name: TABLE custom_field_definition; Type: COMMENT; Schema: collaboration; Owner: -
--

COMMENT ON TABLE collaboration.custom_field_definition IS 'Custom field definitions per project. Supports text, number, single/multi select, date, user, checkbox field types.';


--
-- Name: COLUMN custom_field_definition.field_type; Type: COMMENT; Schema: collaboration; Owner: -
--

COMMENT ON COLUMN collaboration.custom_field_definition.field_type IS 'Field type: text, number, single_select, multi_select, date, user (employee picker), checkbox. MUST align with backend constants.';


--
-- Name: COLUMN custom_field_definition.options; Type: COMMENT; Schema: collaboration; Owner: -
--

COMMENT ON COLUMN collaboration.custom_field_definition.options IS 'For select types: array of option values. Example: ["XS", "S", "M", "L", "XL"] for t-shirt sizes.';


--
-- Name: custom_field_value; Type: TABLE; Schema: collaboration; Owner: -
--

CREATE TABLE collaboration.custom_field_value (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    task_id uuid NOT NULL,
    field_definition_id uuid NOT NULL,
    value jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE custom_field_value; Type: COMMENT; Schema: collaboration; Owner: -
--

COMMENT ON TABLE collaboration.custom_field_value IS 'Custom field values per task. JSONB storage enables flexible value types while maintaining queryability for analytics.';


--
-- Name: COLUMN custom_field_value.value; Type: COMMENT; Schema: collaboration; Owner: -
--

COMMENT ON COLUMN collaboration.custom_field_value.value IS 'Field value as JSONB. Examples: "value text" for text, 5 for number, ["M"] for single_select, ["A","B"] for multi_select, "2024-12-26" for date, "uuid" for user.';


--
-- Name: evidence_requirement; Type: TABLE; Schema: collaboration; Owner: -
--

CREATE TABLE collaboration.evidence_requirement (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    ritual_definition_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    evidence_types text[] DEFAULT '{}'::text[] NOT NULL,
    is_required boolean DEFAULT true NOT NULL,
    approval_mode text DEFAULT 'manual'::text NOT NULL,
    auto_approve_config jsonb,
    "position" integer DEFAULT 0 NOT NULL,
    deadline_offset_hours integer,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT evidence_requirement_approval_mode_check CHECK ((approval_mode = ANY (ARRAY['manual'::text, 'auto_approve'::text])))
);


--
-- Name: evidence_submission; Type: TABLE; Schema: collaboration; Owner: -
--

CREATE TABLE collaboration.evidence_submission (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    task_id uuid NOT NULL,
    evidence_requirement_id uuid NOT NULL,
    submitted_by_employee_id uuid NOT NULL,
    evidence_type text NOT NULL,
    file_id uuid,
    text_content text,
    link_url text,
    device_timestamp timestamp with time zone,
    server_timestamp timestamp with time zone DEFAULT now() NOT NULL,
    gps_latitude numeric(10,7),
    gps_longitude numeric(10,7),
    gps_accuracy_meters numeric(8,2),
    approval_status text DEFAULT 'pending_review'::text NOT NULL,
    reviewed_by_employee_id uuid,
    reviewed_at timestamp with time zone,
    reviewer_comment text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT evidence_submission_approval_status_check CHECK ((approval_status = ANY (ARRAY['pending_review'::text, 'approved'::text, 'rejected'::text]))),
    CONSTRAINT evidence_submission_evidence_type_check CHECK ((evidence_type = ANY (ARRAY['photo'::text, 'voice_memo'::text, 'pdf'::text, 'file'::text, 'link'::text, 'text_note'::text, 'gps_checkin'::text])))
);


--
-- Name: project; Type: TABLE; Schema: collaboration; Owner: -
--

CREATE TABLE collaboration.project (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    key text NOT NULL,
    description text,
    next_task_number integer DEFAULT 1 NOT NULL,
    visibility text DEFAULT 'private'::text NOT NULL,
    is_archived boolean DEFAULT false NOT NULL,
    owner_employee_id uuid NOT NULL,
    member_count integer DEFAULT 0 NOT NULL,
    task_count integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    collaboration_mode text DEFAULT 'standard'::text NOT NULL,
    CONSTRAINT project_collaboration_mode_check CHECK ((collaboration_mode = ANY (ARRAY['standard'::text, 'ritual'::text, 'mixed'::text]))),
    CONSTRAINT project_member_count_check CHECK ((member_count >= 0)),
    CONSTRAINT project_next_task_number_check CHECK ((next_task_number >= 1)),
    CONSTRAINT project_task_count_check CHECK ((task_count >= 0)),
    CONSTRAINT project_visibility_check CHECK ((visibility = ANY (ARRAY['public'::text, 'private'::text]))),
    CONSTRAINT valid_project_key CHECK ((key ~ '^[A-Z][A-Z0-9_]{0,9}$'::text))
);


--
-- Name: TABLE project; Type: COMMENT; Schema: collaboration; Owner: -
--

COMMENT ON TABLE collaboration.project IS 'Task project container with configurable states and task levels. Projects group related tasks and define workflow.';


--
-- Name: COLUMN project.key; Type: COMMENT; Schema: collaboration; Owner: -
--

COMMENT ON COLUMN collaboration.project.key IS 'Short uppercase identifier (1-10 chars) for task prefixes. Example: "PROJ" creates tasks PROJ-1, PROJ-2. MUST be unique per organization.';


--
-- Name: COLUMN project.next_task_number; Type: COMMENT; Schema: collaboration; Owner: -
--

COMMENT ON COLUMN collaboration.project.next_task_number IS 'Atomic counter for task identifier generation. Incremented on each task creation.';


--
-- Name: COLUMN project.visibility; Type: COMMENT; Schema: collaboration; Owner: -
--

COMMENT ON COLUMN collaboration.project.visibility IS 'Project visibility: public (all org members can view), private (explicit grants only). MUST align with backend constants in internal/collaboration/constants.go.';


--
-- Name: project_membership; Type: TABLE; Schema: collaboration; Owner: -
--

CREATE TABLE collaboration.project_membership (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    notification_preference text DEFAULT 'all'::text NOT NULL,
    joined_at timestamp with time zone DEFAULT now() NOT NULL,
    invited_by_employee_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT project_membership_notification_preference_check CHECK ((notification_preference = ANY (ARRAY['all'::text, 'mentions'::text, 'assigned'::text, 'muted'::text]))),
    CONSTRAINT project_membership_role_check CHECK ((role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text, 'viewer'::text])))
);


--
-- Name: TABLE project_membership; Type: COMMENT; Schema: collaboration; Owner: -
--

COMMENT ON TABLE collaboration.project_membership IS 'Project membership with role-based access control. Roles determine permissions for viewing, editing, and managing projects.';


--
-- Name: COLUMN project_membership.role; Type: COMMENT; Schema: collaboration; Owner: -
--

COMMENT ON COLUMN collaboration.project_membership.role IS 'Member role: owner (full control), admin (manage members), member (edit tasks), viewer (read only). MUST align with backend constants.';


--
-- Name: COLUMN project_membership.notification_preference; Type: COMMENT; Schema: collaboration; Owner: -
--

COMMENT ON COLUMN collaboration.project_membership.notification_preference IS 'Notification preference: all, mentions (only @mentions), assigned (only when assigned), muted. MUST align with backend constants.';


--
-- Name: project_state; Type: TABLE; Schema: collaboration; Owner: -
--

CREATE TABLE collaboration.project_state (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    name text NOT NULL,
    color text DEFAULT '#3b82f6'::text NOT NULL,
    category text DEFAULT 'todo'::text NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    is_initial boolean DEFAULT false NOT NULL,
    is_closed boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    state_type text DEFAULT 'standard'::text NOT NULL,
    CONSTRAINT project_state_category_check CHECK ((category = ANY (ARRAY['todo'::text, 'in_progress'::text, 'done'::text, 'cancelled'::text, 'scheduled'::text, 'submitted'::text, 'verified'::text, 'overdue'::text, 'missed'::text, 'skipped'::text]))),
    CONSTRAINT project_state_type_check CHECK ((state_type = ANY (ARRAY['standard'::text, 'ritual'::text])))
);


--
-- Name: TABLE project_state; Type: COMMENT; Schema: collaboration; Owner: -
--

COMMENT ON TABLE collaboration.project_state IS 'Customizable task states per project. Projects can have unlimited states organized into categories for reporting.';


--
-- Name: COLUMN project_state.category; Type: COMMENT; Schema: collaboration; Owner: -
--

COMMENT ON COLUMN collaboration.project_state.category IS 'State category for reporting: todo (not started), in_progress (active work), done (completed), cancelled. MUST align with backend constants.';


--
-- Name: COLUMN project_state.is_initial; Type: COMMENT; Schema: collaboration; Owner: -
--

COMMENT ON COLUMN collaboration.project_state.is_initial IS 'If true, new tasks start in this state. Only one state per project should be initial.';


--
-- Name: COLUMN project_state.is_closed; Type: COMMENT; Schema: collaboration; Owner: -
--

COMMENT ON COLUMN collaboration.project_state.is_closed IS 'If true, tasks in this state are considered closed/resolved. Used for metrics and analytics.';


--
-- Name: ritual_definition; Type: TABLE; Schema: collaboration; Owner: -
--

CREATE TABLE collaboration.ritual_definition (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    recurrence_rule jsonb NOT NULL,
    completion_window_hours integer DEFAULT 24 NOT NULL,
    timezone text DEFAULT 'UTC'::text NOT NULL,
    is_archived boolean DEFAULT false NOT NULL,
    created_by_employee_id uuid NOT NULL,
    last_generated_date date,
    generation_window_days integer DEFAULT 30 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    schedule_version integer DEFAULT 1 NOT NULL,
    CONSTRAINT ritual_definition_completion_window_hours_check CHECK ((completion_window_hours > 0))
);


--
-- Name: ritual_definition_assignee; Type: TABLE; Schema: collaboration; Owner: -
--

CREATE TABLE collaboration.ritual_definition_assignee (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    ritual_definition_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ritual_definition_department_pool; Type: TABLE; Schema: collaboration; Owner: -
--

CREATE TABLE collaboration.ritual_definition_department_pool (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    ritual_definition_id uuid NOT NULL,
    department_id uuid NOT NULL,
    assignment_strategy text DEFAULT 'round_robin'::text NOT NULL,
    last_assigned_employee_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ritual_definition_department_pool_assignment_strategy_check CHECK ((assignment_strategy = ANY (ARRAY['round_robin'::text, 'least_assigned'::text])))
);


--
-- Name: saved_view; Type: TABLE; Schema: collaboration; Owner: -
--

CREATE TABLE collaboration.saved_view (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    employee_id uuid,
    name text NOT NULL,
    view_type text NOT NULL,
    config jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_default boolean DEFAULT false NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT saved_view_view_type_check CHECK ((view_type = ANY (ARRAY['board'::text, 'list'::text, 'gantt'::text, 'calendar'::text, 'today'::text, 'health'::text])))
);


--
-- Name: TABLE saved_view; Type: COMMENT; Schema: collaboration; Owner: -
--

COMMENT ON TABLE collaboration.saved_view IS 'Saved view configurations for personalized or shared filtering and display settings.';


--
-- Name: COLUMN saved_view.employee_id; Type: COMMENT; Schema: collaboration; Owner: -
--

COMMENT ON COLUMN collaboration.saved_view.employee_id IS 'View owner. NULL indicates a shared project-level view visible to all members.';


--
-- Name: COLUMN saved_view.view_type; Type: COMMENT; Schema: collaboration; Owner: -
--

COMMENT ON COLUMN collaboration.saved_view.view_type IS 'View type: board (kanban), list (table), gantt (timeline), calendar. MUST align with backend constants.';


--
-- Name: COLUMN saved_view.config; Type: COMMENT; Schema: collaboration; Owner: -
--

COMMENT ON COLUMN collaboration.saved_view.config IS 'View configuration: {filters: [{fieldId, operator, value}], groupBy: ["stateId"], columns: ["title", "assignees"], sortBy: [{field, direction}]}';


--
-- Name: task; Type: TABLE; Schema: collaboration; Owner: -
--

CREATE TABLE collaboration.task (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    identifier text NOT NULL,
    title text NOT NULL,
    parent_task_id uuid,
    depth smallint DEFAULT 0 NOT NULL,
    path uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    level_id uuid CONSTRAINT task_level_id_not_null1 NOT NULL,
    state_id uuid NOT NULL,
    start_date date,
    due_date date,
    estimated_hours numeric(8,2),
    channel_id uuid,
    description_document_id uuid,
    file_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    reporter_employee_id uuid NOT NULL,
    child_count integer DEFAULT 0 NOT NULL,
    comment_count integer DEFAULT 0 NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    task_kind text DEFAULT 'standard'::text NOT NULL,
    ritual_definition_id uuid,
    scheduled_date date,
    completion_deadline timestamp with time zone,
    skip_reason text,
    detached_from_ritual boolean DEFAULT false NOT NULL,
    source_channel_id uuid,
    source_message_id uuid,
    CONSTRAINT no_self_parent CHECK (((parent_task_id IS NULL) OR (parent_task_id <> id))),
    CONSTRAINT task_child_count_check CHECK ((child_count >= 0)),
    CONSTRAINT task_comment_count_check CHECK ((comment_count >= 0)),
    CONSTRAINT task_depth_check CHECK (((depth >= 0) AND (depth <= 5))),
    CONSTRAINT task_kind_check CHECK ((task_kind = ANY (ARRAY['standard'::text, 'ritual_instance'::text]))),
    CONSTRAINT task_source_message_consistency CHECK (((source_channel_id IS NULL) = (source_message_id IS NULL))),
    CONSTRAINT valid_date_range CHECK (((start_date IS NULL) OR (due_date IS NULL) OR (start_date <= due_date)))
);


--
-- Name: TABLE task; Type: COMMENT; Schema: collaboration; Owner: -
--

COMMENT ON TABLE collaboration.task IS 'Core task entity with hierarchical nesting, workflow states, and cross-domain integrations to chat (comments), docs (description), and files (attachments).';


--
-- Name: COLUMN task.identifier; Type: COMMENT; Schema: collaboration; Owner: -
--

COMMENT ON COLUMN collaboration.task.identifier IS 'Human-readable task identifier: {project_key}-{number}. Example: PROJ-123. Unique within project.';


--
-- Name: COLUMN task.path; Type: COMMENT; Schema: collaboration; Owner: -
--

COMMENT ON COLUMN collaboration.task.path IS 'Materialized path array of ancestor task IDs from root to parent. Enables efficient subtree queries.';


--
-- Name: COLUMN task.channel_id; Type: COMMENT; Schema: collaboration; Owner: -
--

COMMENT ON COLUMN collaboration.task.channel_id IS 'Chat channel for task comments and discussion. Auto-created on task creation with channel_type=project_ticket_thread.';


--
-- Name: COLUMN task.description_document_id; Type: COMMENT; Schema: collaboration; Owner: -
--

COMMENT ON COLUMN collaboration.task.description_document_id IS 'Linked document for rich task description with versioning and comments. Auto-created on task creation with document_type=task_description. These documents should NOT appear in workspace docs list.';


--
-- Name: COLUMN task.file_ids; Type: COMMENT; Schema: collaboration; Owner: -
--

COMMENT ON COLUMN collaboration.task.file_ids IS 'Array of file UUIDs from files.file_metadata. Managed via Files API with upload_context=project.';


--
-- Name: COLUMN task.source_channel_id; Type: COMMENT; Schema: collaboration; Owner: -
--

COMMENT ON COLUMN collaboration.task.source_channel_id IS 'Chat channel the originating message was posted in. NULL for tasks not created from a message.';


--
-- Name: COLUMN task.source_message_id; Type: COMMENT; Schema: collaboration; Owner: -
--

COMMENT ON COLUMN collaboration.task.source_message_id IS 'Chat message this task was created from. NULL for tasks not created from a message.';


--
-- Name: task_assignee; Type: TABLE; Schema: collaboration; Owner: -
--

CREATE TABLE collaboration.task_assignee (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    task_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    role text DEFAULT 'assignee'::text NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    assigned_by_employee_id uuid NOT NULL,
    CONSTRAINT task_assignee_role_check CHECK ((role = ANY (ARRAY['assignee'::text, 'reviewer'::text, 'approver'::text])))
);


--
-- Name: TABLE task_assignee; Type: COMMENT; Schema: collaboration; Owner: -
--

COMMENT ON TABLE collaboration.task_assignee IS 'Task assignment tracking with support for multiple assignees per task and different roles (assignee, reviewer, approver).';


--
-- Name: COLUMN task_assignee.role; Type: COMMENT; Schema: collaboration; Owner: -
--

COMMENT ON COLUMN collaboration.task_assignee.role IS 'Assignment role: assignee (responsible for work), reviewer (reviews work), approver (approves completion). MUST align with backend constants.';


--
-- Name: task_level; Type: TABLE; Schema: collaboration; Owner: -
--

CREATE TABLE collaboration.task_level (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    name text NOT NULL,
    icon text,
    color text DEFAULT '#6b7280'::text NOT NULL,
    depth integer NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT task_level_depth_check CHECK (((depth >= 0) AND (depth <= 4)))
);


--
-- Name: TABLE task_level; Type: COMMENT; Schema: collaboration; Owner: -
--

COMMENT ON TABLE collaboration.task_level IS 'Task hierarchy level definitions per project. Defines which levels exist (Epic, Story, Task, Subtask) and their nesting rules.';


--
-- Name: COLUMN task_level.depth; Type: COMMENT; Schema: collaboration; Owner: -
--

COMMENT ON COLUMN collaboration.task_level.depth IS 'Hierarchy position: 0=Epic, 1=Story, 2=Task, 3=Subtask, 4=Checklist. Enforces parent-child level ordering.';


--
-- Name: workflow_rule; Type: TABLE; Schema: collaboration; Owner: -
--

CREATE TABLE collaboration.workflow_rule (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    project_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    trigger_type text DEFAULT 'state_entered'::text NOT NULL,
    trigger_state_id uuid,
    trigger_field_id uuid,
    trigger_condition jsonb,
    action_type text NOT NULL,
    action_payload jsonb NOT NULL,
    "position" integer DEFAULT 0 NOT NULL,
    is_enabled boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workflow_rule_action_type_check CHECK ((action_type = ANY (ARRAY['set_state'::text, 'set_field'::text, 'assign_user'::text, 'notify'::text, 'close_task'::text]))),
    CONSTRAINT workflow_rule_trigger_type_check CHECK ((trigger_type = ANY (ARRAY['state_entered'::text, 'state_exited'::text, 'field_changed'::text, 'task_created'::text])))
);


--
-- Name: TABLE workflow_rule; Type: COMMENT; Schema: collaboration; Owner: -
--

COMMENT ON TABLE collaboration.workflow_rule IS 'Workflow automation rules. Triggers execute actions within task update transaction for atomicity.';


--
-- Name: COLUMN workflow_rule.trigger_type; Type: COMMENT; Schema: collaboration; Owner: -
--

COMMENT ON COLUMN collaboration.workflow_rule.trigger_type IS 'Trigger type: state_entered, state_exited, field_changed, task_created. MUST align with backend constants.';


--
-- Name: COLUMN workflow_rule.action_type; Type: COMMENT; Schema: collaboration; Owner: -
--

COMMENT ON COLUMN collaboration.workflow_rule.action_type IS 'Action type: set_state, set_field, assign_user, notify, close_task. MUST align with backend constants.';


--
-- Name: COLUMN workflow_rule.action_payload; Type: COMMENT; Schema: collaboration; Owner: -
--

COMMENT ON COLUMN collaboration.workflow_rule.action_payload IS 'Action payload: {"stateId": "..."} for set_state, {"fieldId": "...", "value": ...} for set_field, {"employeeId": "..."} for assign_user.';


--
-- Name: workflow_rule_execution; Type: TABLE; Schema: collaboration; Owner: -
--

CREATE TABLE collaboration.workflow_rule_execution (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    rule_id uuid NOT NULL,
    task_id uuid NOT NULL,
    status text NOT NULL,
    error_message text,
    triggered_by_employee_id uuid NOT NULL,
    execution_context jsonb,
    executed_at timestamp with time zone DEFAULT now() NOT NULL,
    duration_ms integer,
    CONSTRAINT workflow_rule_execution_status_check CHECK ((status = ANY (ARRAY['success'::text, 'failed'::text, 'skipped'::text])))
);


--
-- Name: TABLE workflow_rule_execution; Type: COMMENT; Schema: collaboration; Owner: -
--

COMMENT ON TABLE collaboration.workflow_rule_execution IS 'Audit log tracking workflow rule executions. Used for debugging and analytics.';


--
-- Name: account_deletion; Type: TABLE; Schema: compliance; Owner: -
--

CREATE TABLE compliance.account_deletion (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    state text DEFAULT 'pending'::text NOT NULL,
    trigger text NOT NULL,
    failure_reason text,
    attempts integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT account_deletion_state_check CHECK ((state = ANY (ARRAY['pending'::text, 'anonymising'::text, 'purging'::text, 'done'::text, 'failed'::text]))),
    CONSTRAINT account_deletion_trigger_check CHECK ((trigger = ANY (ARRAY['self_service'::text, 'removal_request_granted'::text])))
);


--
-- Name: TABLE account_deletion; Type: COMMENT; Schema: compliance; Owner: -
--

COMMENT ON TABLE compliance.account_deletion IS 'Resumable record of an account erase in progress: one row per organization the person belongs to. Whichever row purges last finds no iam.identity rows remaining for the user and destroys the global iam.user record, so the terminal step needs no marker column. A failure leaves the row in its last completed state for the worker to retry.';


--
-- Name: block; Type: TABLE; Schema: compliance; Owner: -
--

CREATE TABLE compliance.block (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    blocker_employee_id uuid NOT NULL,
    blocked_employee_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT compliance_block_not_self CHECK ((blocker_employee_id <> blocked_employee_id))
);


--
-- Name: TABLE block; Type: COMMENT; Schema: compliance; Owner: -
--

COMMENT ON TABLE compliance.block IS 'One-directional block scoped to direct contact within an organization. Unblocking deletes the row; no history is kept. Never notifies the blocked person (FR-022) and never touches channel membership (FR-023).';


--
-- Name: content_report; Type: TABLE; Schema: compliance; Owner: -
--

CREATE TABLE compliance.content_report (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    reporter_employee_id uuid NOT NULL,
    reported_employee_id uuid NOT NULL,
    target_kind text NOT NULL,
    target_id uuid NOT NULL,
    content_snapshot text NOT NULL,
    reason text NOT NULL,
    note text,
    status text DEFAULT 'outstanding'::text NOT NULL,
    outcome_note text,
    reviewed_by_employee_id uuid,
    reviewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT content_report_reason_check CHECK ((reason = ANY (ARRAY['harassment'::text, 'hate_speech'::text, 'sexual_content'::text, 'violence'::text, 'spam'::text, 'other'::text]))),
    CONSTRAINT content_report_status_check CHECK ((status = ANY (ARRAY['outstanding'::text, 'actioned'::text, 'dismissed'::text]))),
    CONSTRAINT content_report_target_kind_check CHECK ((target_kind = ANY (ARRAY['chat_message'::text, 'direct_message'::text, 'file'::text, 'document_comment'::text, 'call_record'::text])))
);


--
-- Name: TABLE content_report; Type: COMMENT; Schema: compliance; Owner: -
--

COMMENT ON TABLE compliance.content_report IS 'One person''s assertion that a specific item is abusive. content_snapshot records the content as it stood at report time so the report outlives deletion of its subject (FR-018).';


--
-- Name: removal_request; Type: TABLE; Schema: compliance; Owner: -
--

CREATE TABLE compliance.removal_request (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    status text DEFAULT 'outstanding'::text NOT NULL,
    note text,
    decided_by_employee_id uuid,
    decided_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT removal_request_status_check CHECK ((status = ANY (ARRAY['outstanding'::text, 'granted'::text, 'declined'::text])))
);


--
-- Name: TABLE removal_request; Type: COMMENT; Schema: compliance; Owner: -
--

COMMENT ON TABLE compliance.removal_request IS 'An admin-provisioned worker asking to be removed from an organization. Granting ends the membership and, when it was the last, enqueues the global purge.';


--
-- Name: comment; Type: TABLE; Schema: docs; Owner: -
--

CREATE TABLE docs.comment (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    document_id uuid NOT NULL,
    block_id uuid,
    text_selection_start integer,
    text_selection_end integer,
    comment_text text NOT NULL,
    author_employee_id uuid NOT NULL,
    is_resolved boolean DEFAULT false NOT NULL,
    resolved_by_employee_id uuid,
    resolved_at timestamp with time zone,
    reply_count integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT comment_reply_count_check CHECK ((reply_count >= 0))
);


--
-- Name: TABLE comment; Type: COMMENT; Schema: docs; Owner: -
--

COMMENT ON TABLE docs.comment IS 'Inline comments anchored to document blocks. Supports text selection ranges and threaded replies.';


--
-- Name: comment_reply; Type: TABLE; Schema: docs; Owner: -
--

CREATE TABLE docs.comment_reply (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    comment_id uuid NOT NULL,
    reply_text text NOT NULL,
    author_employee_id uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE comment_reply; Type: COMMENT; Schema: docs; Owner: -
--

COMMENT ON TABLE docs.comment_reply IS 'Replies to inline comments. One level of threading only (no nested replies).';


--
-- Name: document; Type: TABLE; Schema: docs; Owner: -
--

CREATE TABLE docs.document (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    title text NOT NULL,
    slug text NOT NULL,
    document_type text DEFAULT 'workspace_doc'::text NOT NULL,
    parent_document_id uuid,
    depth smallint DEFAULT 0 NOT NULL,
    path uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    content_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    content_text text DEFAULT ''::text NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    visibility text DEFAULT 'private'::text NOT NULL,
    owner_employee_id uuid NOT NULL,
    child_count integer DEFAULT 0 NOT NULL,
    version_count integer DEFAULT 1 NOT NULL,
    follower_count integer DEFAULT 0 NOT NULL,
    is_deleted boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT document_child_count_check CHECK ((child_count >= 0)),
    CONSTRAINT document_depth_check CHECK (((depth >= 0) AND (depth <= 10))),
    CONSTRAINT document_document_type_check CHECK ((document_type = ANY (ARRAY['workspace_doc'::text, 'task_description'::text, 'project_brief'::text]))),
    CONSTRAINT document_follower_count_check CHECK ((follower_count >= 0)),
    CONSTRAINT document_status_check CHECK ((status = ANY (ARRAY['active'::text, 'outdated'::text, 'archived'::text]))),
    CONSTRAINT document_version_count_check CHECK ((version_count >= 1)),
    CONSTRAINT document_visibility_check CHECK ((visibility = ANY (ARRAY['public'::text, 'private'::text]))),
    CONSTRAINT root_visibility CHECK (((parent_document_id IS NULL) OR ((parent_document_id IS NOT NULL) AND (depth > 0))))
);


--
-- Name: TABLE document; Type: COMMENT; Schema: docs; Owner: -
--

COMMENT ON TABLE docs.document IS 'Core document entity for Notion/Confluence-style documentation. Supports hierarchical nesting (max 10 levels), 
full-text search, and permanent slug-based URLs.';


--
-- Name: COLUMN document.slug; Type: COMMENT; Schema: docs; Owner: -
--

COMMENT ON COLUMN docs.document.slug IS 'URL-friendly identifier: {title-slug}-{base62-uuid}. Permanent across renames via slug_history redirect.';


--
-- Name: COLUMN document.document_type; Type: COMMENT; Schema: docs; Owner: -
--

COMMENT ON COLUMN docs.document.document_type IS 'Document type: workspace_doc (regular docs in workspace), task_description (linked to tasks), project_brief (linked to projects). MUST align with backend constants in internal/docs/constants.go and frontend TypeScript types in packages/apis/src/docs.ts. Task descriptions and project briefs should NOT appear in workspace docs list.';


--
-- Name: COLUMN document.path; Type: COMMENT; Schema: docs; Owner: -
--

COMMENT ON COLUMN docs.document.path IS 'Materialized path array of ancestor document IDs from root to parent. Enables efficient subtree queries.';


--
-- Name: COLUMN document.content_json; Type: COMMENT; Schema: docs; Owner: -
--

COMMENT ON COLUMN docs.document.content_json IS 'TipTap/ProseMirror document JSON with block IDs for section linking. Yjs-compatible for real-time collaboration.';


--
-- Name: COLUMN document.content_text; Type: COMMENT; Schema: docs; Owner: -
--

COMMENT ON COLUMN docs.document.content_text IS 'Plain text extraction for PGroonga full-text search. Updated on every save.';


--
-- Name: COLUMN document.status; Type: COMMENT; Schema: docs; Owner: -
--

COMMENT ON COLUMN docs.document.status IS 'Document lifecycle status: active, outdated, archived. MUST align with backend constants in internal/docs/constants.go and frontend types in packages/apis/src/docs.ts.';


--
-- Name: COLUMN document.visibility; Type: COMMENT; Schema: docs; Owner: -
--

COMMENT ON COLUMN docs.document.visibility IS 'Root document visibility: public (organization-wide), private (explicit grants only). Children inherit.';


--
-- Name: document_access; Type: TABLE; Schema: docs; Owner: -
--

CREATE TABLE docs.document_access (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    document_id uuid NOT NULL,
    grantee_type text NOT NULL,
    grantee_id uuid NOT NULL,
    access_level text NOT NULL,
    granted_by_employee_id uuid NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT document_access_access_level_check CHECK ((access_level = ANY (ARRAY['read_comment'::text, 'write_update'::text, 'none'::text]))),
    CONSTRAINT document_access_grantee_type_check CHECK ((grantee_type = ANY (ARRAY['employee'::text, 'department'::text])))
);


--
-- Name: TABLE document_access; Type: COMMENT; Schema: docs; Owner: -
--

COMMENT ON TABLE docs.document_access IS 'Permission grants for private documents. Grantees can be employees or departments. Children inherit but can only restrict.';


--
-- Name: COLUMN document_access.grantee_type; Type: COMMENT; Schema: docs; Owner: -
--

COMMENT ON COLUMN docs.document_access.grantee_type IS 'Type of grantee: employee (individual), department (team grant). MUST align with backend constants in internal/docs/constants.go.';


--
-- Name: COLUMN document_access.access_level; Type: COMMENT; Schema: docs; Owner: -
--

COMMENT ON COLUMN docs.document_access.access_level IS 'Permission level: read_comment (view+comment), write_update (edit), none (explicit deny). MUST align with backend constants in internal/docs/constants.go.';


--
-- Name: document_editor; Type: TABLE; Schema: docs; Owner: -
--

CREATE UNLOGGED TABLE docs.document_editor (
    organization_id uuid NOT NULL,
    document_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    connection_id uuid NOT NULL,
    instance_id text NOT NULL,
    cursor_position jsonb,
    connected_at timestamp with time zone DEFAULT now() NOT NULL,
    last_heartbeat timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE document_editor; Type: COMMENT; Schema: docs; Owner: -
--

COMMENT ON TABLE docs.document_editor IS 'UNLOGGED table tracking active document editors. Max 10 per document. Data lost on crash is acceptable (editors reconnect). 2-3x faster writes.';


--
-- Name: COLUMN document_editor.instance_id; Type: COMMENT; Schema: docs; Owner: -
--

COMMENT ON COLUMN docs.document_editor.instance_id IS 'Backend instance hosting WebSocket connection. Used for routing real-time sync messages.';


--
-- Name: COLUMN document_editor.cursor_position; Type: COMMENT; Schema: docs; Owner: -
--

COMMENT ON COLUMN docs.document_editor.cursor_position IS 'Current cursor position: {block_id: "uuid", offset: 123}. Used for cursor awareness display.';


--
-- Name: document_reaction; Type: TABLE; Schema: docs; Owner: -
--

CREATE TABLE docs.document_reaction (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    document_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    reaction_type text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT document_reaction_reaction_type_check CHECK ((reaction_type = ANY (ARRAY['thumbs_up'::text, 'thumbs_down'::text])))
);


--
-- Name: TABLE document_reaction; Type: COMMENT; Schema: docs; Owner: -
--

COMMENT ON TABLE docs.document_reaction IS 'Document reactions for feedback (thumbs up/down). One reaction per employee per document (can change vote).';


--
-- Name: COLUMN document_reaction.reaction_type; Type: COMMENT; Schema: docs; Owner: -
--

COMMENT ON COLUMN docs.document_reaction.reaction_type IS 'Reaction type: thumbs_up, thumbs_down. MUST align with backend constants in internal/docs/constants.go and frontend TypeScript types in packages/apis/src/docs.ts';


--
-- Name: document_slug_history; Type: TABLE; Schema: docs; Owner: -
--

CREATE TABLE docs.document_slug_history (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    document_id uuid NOT NULL,
    old_slug text NOT NULL,
    changed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE document_slug_history; Type: COMMENT; Schema: docs; Owner: -
--

COMMENT ON TABLE docs.document_slug_history IS 'Tracks slug changes for 301 redirect support. Old slugs permanently redirect to current slug.';


--
-- Name: document_version; Type: TABLE; Schema: docs; Owner: -
--

CREATE TABLE docs.document_version (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    document_id uuid NOT NULL,
    version_number integer NOT NULL,
    content_json jsonb NOT NULL,
    content_text text NOT NULL,
    author_employee_id uuid NOT NULL,
    summary text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT document_version_version_number_check CHECK ((version_number >= 1))
);


--
-- Name: TABLE document_version; Type: COMMENT; Schema: docs; Owner: -
--

COMMENT ON TABLE docs.document_version IS 'Version history with full content snapshots. Enables git blame attribution and diff comparison. No version pruning.';


--
-- Name: COLUMN document_version.content_json; Type: COMMENT; Schema: docs; Owner: -
--

COMMENT ON COLUMN docs.document_version.content_json IS 'Complete TipTap JSON document at this version. Enables exact reconstruction and diff computation.';


--
-- Name: section_embed; Type: TABLE; Schema: docs; Owner: -
--

CREATE TABLE docs.section_embed (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    source_document_id uuid NOT NULL,
    source_line_start integer NOT NULL,
    source_line_end integer NOT NULL,
    target_document_id uuid NOT NULL,
    target_line_start integer NOT NULL,
    target_line_end integer NOT NULL,
    target_version_number integer NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT no_self_embed CHECK ((source_document_id <> target_document_id)),
    CONSTRAINT section_embed_check CHECK ((source_line_end >= source_line_start)),
    CONSTRAINT section_embed_check1 CHECK ((target_line_end >= target_line_start)),
    CONSTRAINT section_embed_source_line_start_check CHECK ((source_line_start > 0)),
    CONSTRAINT section_embed_target_line_start_check CHECK ((target_line_start > 0))
);


--
-- Name: TABLE section_embed; Type: COMMENT; Schema: docs; Owner: -
--

COMMENT ON TABLE docs.section_embed IS 'Cross-document section citations using line-based selection. Embeds create VERSION SNAPSHOTS at creation time - they reference the specific version of the target document that was visible when the embed was created. This prevents embedded content from changing unexpectedly when the source document is updated. Version tracking enables staleness detection and optional "update to latest" functionality.';


--
-- Name: COLUMN section_embed.target_line_start; Type: COMMENT; Schema: docs; Owner: -
--

COMMENT ON COLUMN docs.section_embed.target_line_start IS 'First line number (1-indexed) of embedded content from target document. Used for URL generation (#L10-L15) and content extraction.';


--
-- Name: COLUMN section_embed.target_version_number; Type: COMMENT; Schema: docs; Owner: -
--

COMMENT ON COLUMN docs.section_embed.target_version_number IS 'REQUIRED: Version of target document at embed creation time. Embeds are snapshots, NOT live-tracking. This ensures embedded content remains stable even if target document is updated. Backend auto-populates with current version if not explicitly provided. Staleness detection compares this with target document current version.';


--
-- Name: file_access_rule; Type: TABLE; Schema: files; Owner: -
--

CREATE TABLE files.file_access_rule (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    file_id uuid NOT NULL,
    context_type text NOT NULL,
    context_id uuid NOT NULL,
    access_scope text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT file_access_rule_access_scope_check CHECK ((access_scope = ANY (ARRAY['public'::text, 'private'::text, 'department'::text]))),
    CONSTRAINT file_access_rule_context_type_check CHECK ((context_type = ANY (ARRAY['chat_channel'::text, 'project'::text, 'department_docs'::text, 'calendar_event'::text, 'support_ticket'::text, 'crm_deal'::text])))
);


--
-- Name: TABLE file_access_rule; Type: COMMENT; Schema: files; Owner: -
--

COMMENT ON TABLE files.file_access_rule IS 'Links files to their upload contexts (channel, project, docs) and defines access scope (public, private, department). One row per file. Created by domain services (ChatService, DocsService) during upload flow, NOT by client.';


--
-- Name: COLUMN file_access_rule.context_type; Type: COMMENT; Schema: files; Owner: -
--

COMMENT ON COLUMN files.file_access_rule.context_type IS 'Upload context type: chat_channel, project, department_docs, calendar_event, support_ticket, crm_deal. MUST align with backend constants in internal/files/constants.go and frontend TypeScript types in packages/apis/src/files.ts. Set by domain service (e.g., ChatService for chat_channel), NOT client-controlled.';


--
-- Name: COLUMN file_access_rule.access_scope; Type: COMMENT; Schema: files; Owner: -
--

COMMENT ON COLUMN files.file_access_rule.access_scope IS 'Access scope: public (all organization members), private (context members only), department (department members only). MUST align with backend constants in internal/files/constants.go. Derived from context properties (e.g., channel.is_private), NOT client-controlled.';


--
-- Name: file_content_index; Type: TABLE; Schema: files; Owner: -
--

CREATE TABLE files.file_content_index (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    file_id uuid NOT NULL,
    extracted_text text NOT NULL,
    extraction_method text DEFAULT 'plain_text'::text NOT NULL,
    indexing_status text DEFAULT 'pending'::text NOT NULL,
    indexing_error text,
    indexing_duration_ms integer,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT file_content_index_extraction_method_check CHECK ((extraction_method = ANY (ARRAY['office_parser'::text, 'pdf_parser'::text, 'image_ocr'::text, 'plain_text'::text]))),
    CONSTRAINT file_content_index_indexing_status_check CHECK ((indexing_status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'completed'::text, 'failed'::text])))
);


--
-- Name: TABLE file_content_index; Type: COMMENT; Schema: files; Owner: -
--

COMMENT ON TABLE files.file_content_index IS 'Stores extracted text content from files for full-text search using PGroonga. One row per indexed file. PGroonga automatically handles multilingual content without language detection.';


--
-- Name: COLUMN file_content_index.extracted_text; Type: COMMENT; Schema: files; Owner: -
--

COMMENT ON COLUMN files.file_content_index.extracted_text IS 'Plain text content extracted from file. PGroonga automatically tokenizes and indexes for multilingual full-text search (handles Latin, CJK, and all other scripts).';


--
-- Name: COLUMN file_content_index.extraction_method; Type: COMMENT; Schema: files; Owner: -
--

COMMENT ON COLUMN files.file_content_index.extraction_method IS 'Method used to extract text: office_parser (DOCX/XLSX/PPTX), pdf_parser (PDF), image_ocr (future), plain_text. MUST align with backend constants in internal/files/constants.go';


--
-- Name: COLUMN file_content_index.indexing_status; Type: COMMENT; Schema: files; Owner: -
--

COMMENT ON COLUMN files.file_content_index.indexing_status IS 'Indexing status: pending (queued), in_progress (extracting), completed (done), failed (error). MUST align with backend constants in internal/files/constants.go and frontend TypeScript types in packages/apis/src/files.ts';


--
-- Name: file_deletion_log; Type: TABLE; Schema: files; Owner: -
--

CREATE TABLE files.file_deletion_log (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    file_id uuid NOT NULL,
    original_filename text NOT NULL,
    deleted_by_employee_id uuid NOT NULL,
    deletion_reason text,
    deleted_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE file_deletion_log; Type: COMMENT; Schema: files; Owner: -
--

COMMENT ON TABLE files.file_deletion_log IS 'Immutable audit trail for file deletions with reason tracking. Preserves deletion context even after file metadata removed.';


--
-- Name: COLUMN file_deletion_log.file_id; Type: COMMENT; Schema: files; Owner: -
--

COMMENT ON COLUMN files.file_deletion_log.file_id IS 'Reference to deleted file. Does NOT have foreign key constraint to allow deletion log to persist after file_metadata removal.';


--
-- Name: COLUMN file_deletion_log.deletion_reason; Type: COMMENT; Schema: files; Owner: -
--

COMMENT ON COLUMN files.file_deletion_log.deletion_reason IS 'Optional human-readable reason for deletion (e.g., "Policy violation", "User request", "Cleanup").';


--
-- Name: file_metadata; Type: TABLE; Schema: files; Owner: -
--

CREATE TABLE files.file_metadata (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    original_filename text NOT NULL,
    storage_key text NOT NULL,
    size_bytes bigint NOT NULL,
    mime_type text NOT NULL,
    upload_context text NOT NULL,
    uploaded_by_employee_id uuid NOT NULL,
    validation_status text DEFAULT 'pending'::text,
    validation_message text,
    detected_mime_type text,
    is_deleted boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT file_metadata_size_bytes_check CHECK ((size_bytes > 0)),
    CONSTRAINT file_metadata_upload_context_check CHECK ((upload_context = ANY (ARRAY['chat'::text, 'avatar'::text, 'docs'::text, 'project'::text, 'calendar'::text, 'voice_transcript'::text]))),
    CONSTRAINT file_metadata_validation_status_check CHECK ((validation_status = ANY (ARRAY['pending'::text, 'verified'::text, 'warning'::text, 'failed'::text, 'skipped'::text, 'dangerous'::text])))
);


--
-- Name: TABLE file_metadata; Type: COMMENT; Schema: files; Owner: -
--

COMMENT ON TABLE files.file_metadata IS 'Stores metadata for all uploaded files. Actual binary data stored in Cloudflare R2 using storage_key.';


--
-- Name: COLUMN file_metadata.storage_key; Type: COMMENT; Schema: files; Owner: -
--

COMMENT ON COLUMN files.file_metadata.storage_key IS 'R2 object key format: org-{organization_id}/{upload_context}/{file_id}. Used to construct presigned URLs.';


--
-- Name: COLUMN file_metadata.upload_context; Type: COMMENT; Schema: files; Owner: -
--

COMMENT ON COLUMN files.file_metadata.upload_context IS 'Upload source context: chat, avatar, docs, project, calendar, voice_transcript. MUST align with backend constants in internal/files/constants.go and frontend TypeScript types in packages/apis/src/files.ts';


--
-- Name: COLUMN file_metadata.validation_status; Type: COMMENT; Schema: files; Owner: -
--

COMMENT ON COLUMN files.file_metadata.validation_status IS 'File type validation status: pending (not yet validated), verified (type matches), warning (type mismatch but allowed), failed (validation error), skipped (no validation performed), dangerous (virus detected). MUST align with backend constants in internal/files/constants.go and frontend TypeScript types in packages/apis/src/files.ts';


--
-- Name: COLUMN file_metadata.is_deleted; Type: COMMENT; Schema: files; Owner: -
--

COMMENT ON COLUMN files.file_metadata.is_deleted IS 'Soft delete flag. When true, file is deleted from R2 but metadata preserved for audit trail.';


--
-- Name: file_pdf_conversion; Type: TABLE; Schema: files; Owner: -
--

CREATE TABLE files.file_pdf_conversion (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    original_file_id uuid NOT NULL,
    pdf_storage_key text NOT NULL,
    pdf_size_bytes bigint NOT NULL,
    conversion_status text DEFAULT 'pending'::text NOT NULL,
    conversion_error text,
    conversion_duration_ms integer,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT file_pdf_conversion_conversion_status_check CHECK ((conversion_status = ANY (ARRAY['pending'::text, 'in_progress'::text, 'completed'::text, 'failed'::text]))),
    CONSTRAINT file_pdf_conversion_pdf_size_bytes_check CHECK ((pdf_size_bytes >= 0))
);


--
-- Name: TABLE file_pdf_conversion; Type: COMMENT; Schema: files; Owner: -
--

COMMENT ON TABLE files.file_pdf_conversion IS 'Tracks PDF conversions of office documents for in-browser preview. One row per converted file.';


--
-- Name: COLUMN file_pdf_conversion.pdf_storage_key; Type: COMMENT; Schema: files; Owner: -
--

COMMENT ON COLUMN files.file_pdf_conversion.pdf_storage_key IS 'R2 object key for converted PDF. Format: org-{organization_id}/conversions/{original_file_id}.pdf';


--
-- Name: COLUMN file_pdf_conversion.conversion_status; Type: COMMENT; Schema: files; Owner: -
--

COMMENT ON COLUMN files.file_pdf_conversion.conversion_status IS 'Conversion status: pending (queued), in_progress (converting), completed (done), failed (error). MUST align with backend constants in internal/files/constants.go and frontend TypeScript types in packages/apis/src/files.ts';


--
-- Name: COLUMN file_pdf_conversion.conversion_duration_ms; Type: COMMENT; Schema: files; Owner: -
--

COMMENT ON COLUMN files.file_pdf_conversion.conversion_duration_ms IS 'Time taken for conversion in milliseconds. Used for performance monitoring and SLO tracking.';


--
-- Name: file_quota; Type: TABLE; Schema: files; Owner: -
--

CREATE TABLE files.file_quota (
    organization_id uuid NOT NULL,
    quota_bytes bigint,
    max_file_size_bytes bigint DEFAULT 104857600 NOT NULL,
    current_usage_bytes bigint DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT file_quota_current_usage_bytes_check CHECK ((current_usage_bytes >= 0))
);


--
-- Name: TABLE file_quota; Type: COMMENT; Schema: files; Owner: -
--

COMMENT ON TABLE files.file_quota IS 'Per-organization storage quota configuration and real-time usage tracking. One row per organization.';


--
-- Name: COLUMN file_quota.quota_bytes; Type: COMMENT; Schema: files; Owner: -
--

COMMENT ON COLUMN files.file_quota.quota_bytes IS 'Maximum storage quota in bytes. NULL means unlimited quota. Enforced atomically during upload.';


--
-- Name: COLUMN file_quota.max_file_size_bytes; Type: COMMENT; Schema: files; Owner: -
--

COMMENT ON COLUMN files.file_quota.max_file_size_bytes IS 'Maximum individual file size in bytes. Default 100MB (104857600 bytes). Configurable per organization.';


--
-- Name: COLUMN file_quota.current_usage_bytes; Type: COMMENT; Schema: files; Owner: -
--

COMMENT ON COLUMN files.file_quota.current_usage_bytes IS 'Real-time cumulative storage usage in bytes. Incremented on upload, decremented on deletion. Updated atomically with row-level locking.';


--
-- Name: events; Type: TABLE; Schema: flows; Owner: -
--

CREATE TABLE flows.events (
    workflow_name_shard text NOT NULL,
    run_id uuid NOT NULL,
    event_name text NOT NULL,
    payload_json jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: random; Type: TABLE; Schema: flows; Owner: -
--

CREATE TABLE flows.random (
    workflow_name_shard text NOT NULL,
    run_id uuid NOT NULL,
    rand_key text NOT NULL,
    kind text NOT NULL,
    value_text text,
    value_bigint bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: runs; Type: TABLE; Schema: flows; Owner: -
--

CREATE TABLE flows.runs (
    workflow_name_shard text NOT NULL,
    run_id uuid NOT NULL,
    workflow_name text NOT NULL,
    status text NOT NULL,
    input_json jsonb NOT NULL,
    output_json jsonb,
    error_text text,
    next_wake_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: schedules; Type: TABLE; Schema: flows; Owner: -
--

CREATE TABLE flows.schedules (
    schedule_id text NOT NULL,
    workflow_name text NOT NULL,
    cron_expr text NOT NULL,
    input_json jsonb NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    last_run_at timestamp with time zone,
    next_run_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: steps; Type: TABLE; Schema: flows; Owner: -
--

CREATE TABLE flows.steps (
    workflow_name_shard text NOT NULL,
    run_id uuid NOT NULL,
    step_key text NOT NULL,
    status text NOT NULL,
    input_json jsonb,
    output_json jsonb,
    error_text text,
    attempts integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: waits; Type: TABLE; Schema: flows; Owner: -
--

CREATE TABLE flows.waits (
    workflow_name_shard text NOT NULL,
    run_id uuid NOT NULL,
    wait_key text NOT NULL,
    wait_type text NOT NULL,
    event_name text,
    wake_at timestamp with time zone,
    payload_json jsonb,
    satisfied_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: account_lockout; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam.account_lockout (
    organization_id uuid NOT NULL,
    identity_id uuid NOT NULL,
    failed_attempts integer DEFAULT 0 NOT NULL,
    lockout_tier integer DEFAULT 0 NOT NULL,
    lockout_until timestamp with time zone,
    last_failed_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT account_lockout_lockout_tier_check CHECK (((lockout_tier >= 0) AND (lockout_tier <= 4)))
);


--
-- Name: TABLE account_lockout; Type: COMMENT; Schema: iam; Owner: -
--

COMMENT ON TABLE iam.account_lockout IS 'Tracks consecutive failed PIN authentication attempts per identity. Enforces escalating lockouts: tier 1 (3 fails, 1 min), tier 2 (4 fails, 5 min), tier 3 (5 fails, 15 min), tier 4 (6 fails, full lock requiring admin reset). Reset to tier 0 on successful auth. lockout_tier MUST align with backend constants.';


--
-- Name: COLUMN account_lockout.lockout_tier; Type: COMMENT; Schema: iam; Owner: -
--

COMMENT ON COLUMN iam.account_lockout.lockout_tier IS 'Current lockout escalation tier: 0=no lockout, 1=1min, 2=5min, 3=15min, 4=full lock (admin reset required).';


--
-- Name: credential; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam.credential (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    identity_id uuid NOT NULL,
    credential_type text NOT NULL,
    credential_hash text NOT NULL,
    state text DEFAULT 'active'::text NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '3 days'::interval),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT credential_credential_type_check CHECK ((credential_type = ANY (ARRAY['pin'::text, 'biometric'::text]))),
    CONSTRAINT credential_state_check CHECK ((state = ANY (ARRAY['active'::text, 'temporary'::text, 'revoked'::text])))
);


--
-- Name: TABLE credential; Type: COMMENT; Schema: iam; Owner: -
--

COMMENT ON TABLE iam.credential IS 'Org-scoped credentials for PIN and biometric authentication. Supports temporary (admin-generated) and active (user-set) states. One active credential per type per identity. Temporary PINs default to 3-day expiry (configurable via column default). credential_type and state MUST align with backend constants.';


--
-- Name: COLUMN credential.credential_hash; Type: COMMENT; Schema: iam; Owner: -
--

COMMENT ON COLUMN iam.credential.credential_hash IS 'Bcrypt hash of the credential value (PIN digits, biometric key). Never stored in plaintext after initial generation.';


--
-- Name: COLUMN credential.expires_at; Type: COMMENT; Schema: iam; Owner: -
--

COMMENT ON COLUMN iam.credential.expires_at IS 'Expiry timestamp for temporary credentials. Default 3 days from creation (configurable by updating column default). NULL or past = expired. Only meaningful for state=temporary.';


--
-- Name: employee_role; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam.employee_role (
    organization_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    role_id uuid NOT NULL,
    assigned_at timestamp with time zone DEFAULT now(),
    assigned_by uuid
);


--
-- Name: TABLE employee_role; Type: COMMENT; Schema: iam; Owner: -
--

COMMENT ON TABLE iam.employee_role IS 'Many-to-many: employees can have multiple roles. Effective permissions = union of all assigned role permissions. Replaces iam.organization_membership.role column.';


--
-- Name: identity; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam.identity (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    email character varying(255),
    identity_type text DEFAULT 'human'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    login_identifier text,
    CONSTRAINT identity_has_identifier CHECK (((email IS NOT NULL) OR (login_identifier IS NOT NULL))),
    CONSTRAINT identity_identity_type_check CHECK ((identity_type = ANY (ARRAY['human'::text, 'service'::text])))
);


--
-- Name: COLUMN identity.id; Type: COMMENT; Schema: iam; Owner: -
--

COMMENT ON COLUMN iam.identity.id IS 'Same UUID as iam.user.id and organization.employee.id for the same person. This invariant is load-bearing: GetUserRoleNamesInOrg filters iam.employee_role.employee_id with a JWT user id, and account deletion enumerates memberships with SELECT organization_id FROM iam.identity WHERE id = $1. Do not allocate a fresh id here.';


--
-- Name: COLUMN identity.login_identifier; Type: COMMENT; Schema: iam; Owner: -
--

COMMENT ON COLUMN iam.identity.login_identifier IS 'Organization-scoped login handle for workers without email (e.g., badge number, username). Unique within org. NULL for email-based users.';


--
-- Name: invitation; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam.invitation (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    email text NOT NULL,
    role_id uuid NOT NULL,
    token text NOT NULL,
    invited_by uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    accepted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT invitation_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'cancelled'::text, 'expired'::text])))
);


--
-- Name: TABLE invitation; Type: COMMENT; Schema: iam; Owner: -
--

COMMENT ON TABLE iam.invitation IS 'Pending invitations to join organizations. 7-day expiration. Status MUST align with backend constants in internal/iam/constants.go and proto enum rpc.v1.InvitationStatus.';


--
-- Name: COLUMN invitation.token; Type: COMMENT; Schema: iam; Owner: -
--

COMMENT ON COLUMN iam.invitation.token IS 'Secure random token (32 bytes base64url-encoded) for invitation link';


--
-- Name: password_credential; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam.password_credential (
    id uuid DEFAULT uuidv7() NOT NULL,
    user_id uuid NOT NULL,
    password_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE password_credential; Type: COMMENT; Schema: iam; Owner: -
--

COMMENT ON TABLE iam.password_credential IS 'Password credentials for email/password authentication. Optional - users can be SSO-only. password_hash is bcrypt (cost 12).';


--
-- Name: password_reset_token; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam.password_reset_token (
    id uuid DEFAULT uuidv7() NOT NULL,
    user_id uuid NOT NULL,
    token text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE password_reset_token; Type: COMMENT; Schema: iam; Owner: -
--

COMMENT ON TABLE iam.password_reset_token IS 'Time-limited (1 hour), single-use tokens for password reset flow.';


--
-- Name: COLUMN password_reset_token.token; Type: COMMENT; Schema: iam; Owner: -
--

COMMENT ON COLUMN iam.password_reset_token.token IS 'Secure random token (32 bytes base64url-encoded) for reset link';


--
-- Name: role; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam.role (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    is_system boolean DEFAULT false NOT NULL,
    source_default_role_id text
);


--
-- Name: TABLE role; Type: COMMENT; Schema: iam; Owner: -
--

COMMENT ON TABLE iam.role IS 'Organization-specific roles. System roles are seeded from public.default_role on org creation and cannot be deleted. Custom roles have source_default_role_id = NULL.';


--
-- Name: COLUMN role.source_default_role_id; Type: COMMENT; Schema: iam; Owner: -
--

COMMENT ON COLUMN iam.role.source_default_role_id IS 'Links back to public.default_role.id for roles seeded during org creation. NULL for custom-created roles. NOT a foreign key: it points from a tenant table into a global one.';


--
-- Name: role_permission; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam.role_permission (
    organization_id uuid NOT NULL,
    role_id uuid NOT NULL,
    permission_id text NOT NULL
);


--
-- Name: TABLE role_permission; Type: COMMENT; Schema: iam; Owner: -
--

COMMENT ON TABLE iam.role_permission IS 'Maps organization roles to permissions. Seeded from public.default_role_permission on org creation. Mutable — owners can add/remove permissions from roles.';


--
-- Name: session; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam.session (
    id uuid DEFAULT uuidv7() NOT NULL,
    user_id uuid NOT NULL,
    token_jti text NOT NULL,
    issued_at timestamp with time zone NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    last_activity_at timestamp with time zone DEFAULT now(),
    ip_address inet,
    user_agent text,
    invalidated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE session; Type: COMMENT; Schema: iam; Owner: -
--

COMMENT ON TABLE iam.session IS 'Active sessions for tracking, re-auth prompts, and audit. Regular table (not UNLOGGED) - sessions must persist across crashes.';


--
-- Name: COLUMN session.token_jti; Type: COMMENT; Schema: iam; Owner: -
--

COMMENT ON COLUMN iam.session.token_jti IS 'JWT ID (jti claim) for unique session identification';


--
-- Name: sso_identity; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam.sso_identity (
    id uuid DEFAULT uuidv7() NOT NULL,
    user_id uuid NOT NULL,
    provider text NOT NULL,
    provider_user_id text NOT NULL,
    email text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    last_used_at timestamp with time zone DEFAULT now(),
    CONSTRAINT sso_identity_provider_check CHECK ((provider = ANY (ARRAY['google'::text, 'apple'::text])))
);


--
-- Name: TABLE sso_identity; Type: COMMENT; Schema: iam; Owner: -
--

COMMENT ON TABLE iam.sso_identity IS 'SSO provider identities linked to users. Users can have multiple providers (Google + Apple). Provider MUST align with proto enum rpc.v1.SSOProvider.';


--
-- Name: COLUMN sso_identity.provider_user_id; Type: COMMENT; Schema: iam; Owner: -
--

COMMENT ON COLUMN iam.sso_identity.provider_user_id IS 'Unique user ID from SSO provider (sub claim in JWT)';


--
-- Name: user; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam."user" (
    id uuid DEFAULT uuidv7() NOT NULL,
    email text,
    display_name text,
    profile_picture_url text,
    status text DEFAULT 'active'::text NOT NULL,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    is_org_managed boolean DEFAULT false NOT NULL,
    terms_version_accepted text,
    terms_accepted_at timestamp with time zone,
    CONSTRAINT user_status_check CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text, 'deleted'::text])))
);


--
-- Name: TABLE "user"; Type: COMMENT; Schema: iam; Owner: -
--

COMMENT ON TABLE iam."user" IS 'Global user accounts. NOT organization-scoped - users can belong to multiple organizations with different roles. Status MUST align with backend constants in internal/iam/constants.go and proto enum rpc.v1.UserStatus.';


--
-- Name: COLUMN "user".is_org_managed; Type: COMMENT; Schema: iam; Owner: -
--

COMMENT ON COLUMN iam."user".is_org_managed IS 'TRUE for workers created by org admins (PIN-based, no email required). FALSE for self-registered users (email-based).';


--
-- Name: COLUMN "user".terms_version_accepted; Type: COMMENT; Schema: iam; Owner: -
--

COMMENT ON COLUMN iam."user".terms_version_accepted IS 'Version string of the terms this person last accepted. Compared against the current version constant to decide whether to re-prompt. NULL until first acceptance.';


--
-- Name: user_preference; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam.user_preference (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    theme_mode text DEFAULT 'light'::text NOT NULL,
    preference_source text DEFAULT 'os_default'::text NOT NULL,
    additional_preferences jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_preference_preference_source_check CHECK ((preference_source = ANY (ARRAY['manual'::text, 'os_default'::text]))),
    CONSTRAINT user_preference_theme_mode_check CHECK ((theme_mode = ANY (ARRAY['light'::text, 'dark'::text])))
);


--
-- Name: TABLE user_preference; Type: COMMENT; Schema: iam; Owner: -
--

COMMENT ON TABLE iam.user_preference IS 'User-specific application preferences including theme mode, with extensibility for future preferences (notifications, locale, timezone). One record per employee.';


--
-- Name: COLUMN user_preference.theme_mode; Type: COMMENT; Schema: iam; Owner: -
--

COMMENT ON COLUMN iam.user_preference.theme_mode IS 'Active theme mode: light or dark. MUST align with backend constants in internal/preference/constants.go and frontend TypeScript type ThemeMode in packages/apis/src/types.ts';


--
-- Name: COLUMN user_preference.preference_source; Type: COMMENT; Schema: iam; Owner: -
--

COMMENT ON COLUMN iam.user_preference.preference_source IS 'How theme was selected: manual (user clicked toggle) or os_default (detected from prefers-color-scheme). Determines whether OS preference changes should override theme (only if os_default).';


--
-- Name: COLUMN user_preference.additional_preferences; Type: COMMENT; Schema: iam; Owner: -
--

COMMENT ON COLUMN iam.user_preference.additional_preferences IS 'JSONB field for future preference extensions (e.g., {"locale": "en-US", "timezone": "America/New_York", "notifications": {...}}). Enables schema evolution without migrations.';


--
-- Name: active_connection; Type: TABLE; Schema: notification; Owner: -
--

CREATE UNLOGGED TABLE notification.active_connection (
    employee_id uuid NOT NULL,
    instance_id text NOT NULL,
    connection_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    department_ids uuid[],
    connected_at timestamp with time zone DEFAULT now(),
    last_pong_at timestamp with time zone DEFAULT now() NOT NULL,
    presence_status text DEFAULT 'online'::text NOT NULL,
    active_channel_id uuid,
    last_interaction_at timestamp with time zone DEFAULT now() NOT NULL,
    device_identifier text DEFAULT ''::text NOT NULL,
    user_agent text,
    ip_address inet,
    CONSTRAINT presence_status_valid CHECK ((presence_status = ANY (ARRAY['online'::text, 'online_hidden'::text, 'idle'::text, 'offline'::text, 'in_meeting'::text])))
);


--
-- Name: TABLE active_connection; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON TABLE notification.active_connection IS 'UNLOGGED table tracking active SSE connections across backend instances. Data lost on crash is acceptable (users reconnect). 2-3x faster writes than regular table.';


--
-- Name: COLUMN active_connection.instance_id; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.active_connection.instance_id IS 'Backend instance hosting this SSE connection. Example: "backend-pod-abc123" or "instance-1.example.com"';


--
-- Name: COLUMN active_connection.department_ids; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.active_connection.department_ids IS 'Denormalized department membership for single-query department → users → instances resolution. Updated only on reconnect.';


--
-- Name: COLUMN active_connection.last_pong_at; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.active_connection.last_pong_at IS 'Instant the database observed a client answer a presence ping (PresencePong RPC). Advanced ONLY by a received pong — nothing server-side ever refreshes it. Liveness is derived: a connection is a live-delivery target iff last_pong_at >= now() - 45s, and is deleted by the janitor once silent for 90s.';


--
-- Name: COLUMN active_connection.presence_status; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.active_connection.presence_status IS 'Real-time presence indicator reported by each pong. Allowed values: online, online_hidden, idle, offline, in_meeting. Aligned with rpc.v1.PresenceStatus enum.';


--
-- Name: COLUMN active_connection.active_channel_id; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.active_connection.active_channel_id IS 'Channel currently viewed by the connection. Nullable: may be NULL when the connection is not viewing any channel. Used for targeted ephemeral signal routing.';


--
-- Name: COLUMN active_connection.last_interaction_at; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.active_connection.last_interaction_at IS 'Updated on user interactions (typing, clicks) to support idle detection and presence freshness.';


--
-- Name: COLUMN active_connection.device_identifier; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.active_connection.device_identifier IS 'Hashed browser/device fingerprint used to distinguish multiple devices per employee.';


--
-- Name: active_context; Type: TABLE; Schema: notification; Owner: -
--

CREATE UNLOGGED TABLE notification.active_context (
    organization_id uuid NOT NULL,
    connection_id uuid NOT NULL,
    context_type text NOT NULL,
    context_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    last_seen_at timestamp with time zone NOT NULL,
    CONSTRAINT active_context_type_valid CHECK ((context_type = ANY (ARRAY['channel'::text, 'document'::text, 'task'::text])))
);


--
-- Name: TABLE active_context; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON TABLE notification.active_context IS 'UNLOGGED table tracking active realtime context (channel, document, task) per SSE connection. Allows live-only or context-scoped notifications to resolve recipients from current activity context. Data loss on crash is acceptable — clients reconnect and repopulate.';


--
-- Name: COLUMN active_context.context_type; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.active_context.context_type IS 'Type of resource actively viewed: channel (chat), document (docs), task (projects).';


--
-- Name: COLUMN active_context.context_id; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.active_context.context_id IS 'UUID of the actively viewed resource (channel_id, document_id, or task_id).';


--
-- Name: COLUMN active_context.last_seen_at; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.active_context.last_seen_at IS 'Updated on heartbeat or activity. Stale entries indicate the user is no longer viewing the resource.';


--
-- Name: active_listener; Type: TABLE; Schema: notification; Owner: -
--

CREATE TABLE notification.active_listener (
    instance_id text NOT NULL,
    listen_topic text NOT NULL,
    backend_pid integer,
    connected_at timestamp with time zone DEFAULT now() NOT NULL,
    last_heartbeat timestamp with time zone DEFAULT now() NOT NULL,
    listener_status text DEFAULT 'active'::text NOT NULL,
    consumer_status text DEFAULT 'starting'::text NOT NULL,
    consumer_last_active_at timestamp with time zone,
    reconnect_count integer DEFAULT 0 NOT NULL,
    last_error text,
    last_error_at timestamp with time zone,
    CONSTRAINT active_listener_listener_status_check CHECK ((listener_status = ANY (ARRAY['active'::text, 'stale'::text])))
);


--
-- Name: TABLE active_listener; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON TABLE notification.active_listener IS 'Reference-table registry of backend LISTEN connections for instance-scoped notification topics. Used for operational debugging and stale listener cleanup.';


--
-- Name: COLUMN active_listener.listen_topic; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.active_listener.listen_topic IS 'PostgreSQL LISTEN topic currently owned by the backend instance, e.g. instance_backend_pod_abc_notifications.';


--
-- Name: COLUMN active_listener.backend_pid; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.active_listener.backend_pid IS 'Backend PostgreSQL session PID for the dedicated LISTEN connection when available.';


--
-- Name: COLUMN active_listener.last_heartbeat; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.active_listener.last_heartbeat IS 'Updated periodically by the backend listener goroutine. Stale entries indicate the LISTEN loop likely died or the instance crashed.';


--
-- Name: COLUMN active_listener.consumer_status; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.active_listener.consumer_status IS 'Status of the consumeNotifications goroutine: starting, running (processing NOTIFYs), reconnecting (re-establishing connection), stopped (exited). If this is stopped while listener_status=active, the listener heartbeat is alive but notification delivery is broken.';


--
-- Name: COLUMN active_listener.consumer_last_active_at; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.active_listener.consumer_last_active_at IS 'Last time the consumer goroutine successfully processed a NOTIFY event. A large gap between this and last_heartbeat indicates the consumer is stuck or dead.';


--
-- Name: COLUMN active_listener.reconnect_count; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.active_listener.reconnect_count IS 'Number of times the LISTEN connection was re-established after an unexpected disconnection. Non-zero indicates instability.';


--
-- Name: COLUMN active_listener.last_error; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.active_listener.last_error IS 'Most recent error encountered by the consumer goroutine or reconnect logic. Truncated to 500 chars.';


--
-- Name: COLUMN active_listener.last_error_at; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.active_listener.last_error_at IS 'When last_error occurred.';


--
-- Name: delivery_attempt; Type: TABLE; Schema: notification; Owner: -
--

CREATE TABLE notification.delivery_attempt (
    organization_id uuid NOT NULL,
    id uuid DEFAULT uuidv7() NOT NULL,
    notification_recipient_id uuid NOT NULL,
    channel text NOT NULL,
    attempt_status text NOT NULL,
    reason text,
    attempted_at timestamp with time zone NOT NULL,
    instance_id text,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT delivery_attempt_channel_valid CHECK ((channel = ANY (ARRAY['sse'::text, 'push'::text, 'replay'::text, 'call_wake'::text]))),
    CONSTRAINT delivery_attempt_reason_valid CHECK (((reason IS NULL) OR (reason = ANY (ARRAY['live_only_policy'::text, 'no_active_context_match'::text, 'no_push_target'::text, 'recipient_ineligible'::text, 'recipient_online'::text, 'suppressed_by_preference'::text, 'sse_receipt_confirmed'::text, 'acknowledged_before_fallback'::text, 'connection_unresponsive'::text, 'provider_error'::text, 'delivery_error'::text, 'no_call_wake_target'::text, 'native_tier_unavailable'::text, 'call_already_ended'::text, 'acting_device_excluded'::text])))),
    CONSTRAINT delivery_attempt_status_valid CHECK ((attempt_status = ANY (ARRAY['queued'::text, 'sent'::text, 'skipped'::text, 'failed'::text])))
);


--
-- Name: TABLE delivery_attempt; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON TABLE notification.delivery_attempt IS 'Auditable per-channel delivery and fallback outcomes. Supports debugging of why a recipient never saw a notification. Separates canonical recipient summary from detailed attempt history.';


--
-- Name: COLUMN delivery_attempt.channel; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.delivery_attempt.channel IS 'Delivery channel: sse (realtime), push (FCM offline), replay (reconnect replay), call_wake (native call wake, one row per device per call event).';


--
-- Name: COLUMN delivery_attempt.attempt_status; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.delivery_attempt.attempt_status IS 'Outcome of this delivery attempt: queued, sent, skipped, failed.';


--
-- Name: COLUMN delivery_attempt.reason; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.delivery_attempt.reason IS 'Why this attempt was queued, sent, skipped, or failed. Values: live_only_policy, no_active_context_match, no_push_target, recipient_ineligible, recipient_online, suppressed_by_preference, sse_receipt_confirmed, acknowledged_before_fallback, connection_unresponsive, provider_error, delivery_error, no_call_wake_target, native_tier_unavailable, call_already_ended, acting_device_excluded.';


--
-- Name: COLUMN delivery_attempt.instance_id; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.delivery_attempt.instance_id IS 'Backend instance that recorded this attempt. Supports multi-instance debugging.';


--
-- Name: ephemeral_signal; Type: TABLE; Schema: notification; Owner: -
--

CREATE TABLE notification.ephemeral_signal (
    signal_id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    channel_id uuid NOT NULL,
    sender_employee_id uuid NOT NULL,
    signal_type text NOT NULL,
    payload jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT signal_type_valid CHECK ((signal_type = ANY (ARRAY['typing'::text, 'reaction'::text, 'presence'::text])))
)
WITH (autovacuum_vacuum_scale_factor='0.0', autovacuum_vacuum_threshold='1000');


--
-- Name: TABLE ephemeral_signal; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON TABLE notification.ephemeral_signal IS 'Temporary storage for ephemeral events (typing indicators, reactions) following write-then-delete pattern for targeted streaming.';


--
-- Name: COLUMN ephemeral_signal.signal_type; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.ephemeral_signal.signal_type IS 'Ephemeral event type. Allowed values: typing, reaction, presence. Mirrors rpc.v1.EphemeralSignalType enum.';


--
-- Name: live_receipt; Type: TABLE; Schema: notification; Owner: -
--

CREATE TABLE notification.live_receipt (
    organization_id uuid NOT NULL,
    id uuid DEFAULT uuidv7() NOT NULL,
    notification_recipient_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    connection_id uuid NOT NULL,
    platform text NOT NULL,
    app_state text NOT NULL,
    visibility_state text,
    received_at timestamp with time zone NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    CONSTRAINT live_receipt_app_state_valid CHECK ((app_state = ANY (ARRAY['foreground'::text, 'background'::text]))),
    CONSTRAINT live_receipt_platform_valid CHECK ((platform = ANY (ARRAY['web'::text, 'mobile'::text]))),
    CONSTRAINT live_receipt_visibility_valid CHECK (((visibility_state IS NULL) OR (visibility_state = ANY (ARRAY['visible'::text, 'hidden'::text]))))
);


--
-- Name: TABLE live_receipt; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON TABLE notification.live_receipt IS 'Client transport receipts for persistent notification SSE delivery. Does not mark notifications read or acknowledged.';


--
-- Name: COLUMN live_receipt.connection_id; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.live_receipt.connection_id IS 'SSE connection ID that received and parsed the notification event.';


--
-- Name: COLUMN live_receipt.app_state; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.live_receipt.app_state IS 'Client app state at receipt time: foreground or background. Only foreground/visible receipts can suppress rescue push in phase 1.';


--
-- Name: notification; Type: TABLE; Schema: notification; Owner: -
--

CREATE TABLE notification.notification (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    source_domain text NOT NULL,
    notification_type text NOT NULL,
    publishing_service_id text,
    title text NOT NULL,
    message text NOT NULL,
    action_data jsonb,
    action_category text,
    priority smallint DEFAULT 1 NOT NULL,
    policy_key text DEFAULT 'persistent_default'::text NOT NULL,
    delivery_class text DEFAULT 'persistent'::text NOT NULL,
    navigation_target jsonb DEFAULT '{}'::jsonb NOT NULL,
    source_category text DEFAULT 'activity'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT notification_delivery_class_valid CHECK ((delivery_class = ANY (ARRAY['persistent'::text, 'live_only'::text]))),
    CONSTRAINT notification_notification_type_valid CHECK ((notification_type = ANY (ARRAY['message'::text, 'mention'::text, 'reply'::text, 'typing'::text, 'reaction'::text, 'voice_call_incoming'::text, 'voice_call_started'::text, 'voice_call_updated'::text, 'voice_call_ended'::text, 'task_assigned'::text, 'task_status_changed'::text, 'task_commented'::text, 'task_mentioned'::text, 'task_description_modified'::text, 'task_updated'::text, 'doc_updated'::text, 'doc_commented'::text, 'doc_mentioned'::text, 'evidence_submitted'::text, 'evidence_approved'::text, 'evidence_rejected'::text, 'ritual_instances_scheduled'::text, 'calendar_event_invite'::text, 'calendar_event_cancel'::text, 'calendar_event_change'::text, 'calendar_event_reminder'::text, 'calendar_check_in_missed'::text, 'calendar_event_digest'::text, 'account_removal_requested'::text]))),
    CONSTRAINT notification_policy_key_valid CHECK ((policy_key = ANY (ARRAY['persistent_default'::text, 'chat_message'::text, 'chat_mention'::text, 'chat_reply'::text, 'chat_typing_live'::text, 'chat_reaction_live'::text, 'chat_voice_call_incoming'::text, 'chat_voice_call_live'::text, 'chat_voice_call_record'::text, 'task_assignment'::text, 'task_comment'::text, 'task_mention'::text, 'task_status'::text, 'task_description_modified'::text, 'task_update'::text, 'document_update'::text, 'document_comment'::text, 'document_mention'::text, 'calendar_event_invite'::text, 'calendar_event_cancel'::text, 'calendar_event_change'::text, 'calendar_event_reminder'::text, 'calendar_check_in_missed'::text, 'calendar_event_digest'::text]))),
    CONSTRAINT notification_priority_check CHECK ((priority = ANY (ARRAY[0, 1, 2, 4]))),
    CONSTRAINT notification_source_category_valid CHECK ((source_category = ANY (ARRAY['activity'::text, 'mention'::text, 'system'::text]))),
    CONSTRAINT notification_source_domain_valid CHECK ((source_domain = ANY (ARRAY['chat'::text, 'crm'::text, 'projects'::text, 'hr'::text, 'support'::text, 'finance'::text, 'docs'::text, 'system'::text, 'calendar'::text])))
);


--
-- Name: TABLE notification; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON TABLE notification.notification IS 'Core notification data published by backend business domain services';


--
-- Name: COLUMN notification.source_domain; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.notification.source_domain IS 'Backend service that published notification: chat, crm, projects, hr, support, finance, system. MUST align with backend constants in internal/notification/constants.go and frontend TypeScript types in packages/apis/src/notifications.ts';


--
-- Name: COLUMN notification.notification_type; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.notification.notification_type IS 'What happened. MUST equal notification.AllNotificationTypes() in backend/internal/notification/constants.go — TestNotificationTypeCheckMatchesGoConstants asserts it.';


--
-- Name: COLUMN notification.action_data; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.notification.action_data IS 'Flexible metadata for deep linking to source resource. Example: {"chatThreadId": "uuid", "messageId": "uuid"}';


--
-- Name: COLUMN notification.action_category; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.notification.action_category IS 'Category for deduplication grouping. Example: react:like and react:unlike both map to "react"';


--
-- Name: COLUMN notification.priority; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.notification.priority IS 'Delivery priority: 0=always deliver even if offline, 1=deliver when not offline (default), 2=deliver when online only, 4=silent (no delivery)';


--
-- Name: COLUMN notification.policy_key; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.notification.policy_key IS 'Evaluated business delivery policy applied at publication time. MUST align with backend constants in internal/notification/constants.go and proto fields.';


--
-- Name: COLUMN notification.delivery_class; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.notification.delivery_class IS 'Distinguishes persistent notifications (stored in notification center) from live_only transient signals (typing, reactions). live_only notifications do not create recipient rows.';


--
-- Name: COLUMN notification.navigation_target; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.notification.navigation_target IS 'Structured deep-link payload. Example: {"domain":"projects","resourceType":"task","resourceId":"uuid","action":"open_comment"}';


--
-- Name: COLUMN notification.source_category; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.notification.source_category IS 'Frontend grouping axis: activity (general updates), mention (explicit mentions), system (automated/system events).';


--
-- Name: notification_batch; Type: TABLE; Schema: notification; Owner: -
--

CREATE TABLE notification.notification_batch (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    batch_key text NOT NULL,
    publishing_service_id text,
    notification_ids uuid[],
    target_employee_ids uuid[],
    processing_status text DEFAULT 'pending'::text,
    processed_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT notification_batch_processing_status_check CHECK ((processing_status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text])))
);


--
-- Name: TABLE notification_batch; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON TABLE notification.notification_batch IS 'Groups related notifications within time window for efficient batching and deduplication';


--
-- Name: COLUMN notification_batch.batch_key; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.notification_batch.batch_key IS 'Deduplication key: "action_category:source_user_id:resource_id". Example: "react:user-123:comment-456"';


--
-- Name: notification_delivery_log; Type: TABLE; Schema: notification; Owner: -
--

CREATE TABLE notification.notification_delivery_log (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    notification_recipient_id uuid NOT NULL,
    delivery_method text NOT NULL,
    attempt_number smallint NOT NULL,
    delivery_result text NOT NULL,
    error_message text,
    attempted_at timestamp with time zone DEFAULT now(),
    latency_ms integer,
    CONSTRAINT notification_delivery_log_attempt_number_check CHECK ((attempt_number > 0)),
    CONSTRAINT notification_delivery_log_delivery_method_check CHECK ((delivery_method = ANY (ARRAY['sse'::text, 'push'::text, 'email'::text]))),
    CONSTRAINT notification_delivery_log_delivery_result_check CHECK ((delivery_result = ANY (ARRAY['success'::text, 'failed'::text, 'timeout'::text]))),
    CONSTRAINT notification_delivery_log_latency_ms_check CHECK ((latency_ms >= 0))
);


--
-- Name: TABLE notification_delivery_log; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON TABLE notification.notification_delivery_log IS 'Tracks all delivery attempts for debugging and fallback trigger determination';


--
-- Name: COLUMN notification_delivery_log.delivery_method; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.notification_delivery_log.delivery_method IS 'sse = Server-Sent Events (primary), push = mobile push notification, email = email fallback';


--
-- Name: notification_recipient; Type: TABLE; Schema: notification; Owner: -
--

CREATE TABLE notification.notification_recipient (
    id uuid DEFAULT uuidv7() NOT NULL,
    notification_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    read_status boolean DEFAULT false,
    read_at timestamp with time zone,
    delivery_status text DEFAULT 'pending'::text,
    delivered_at timestamp with time zone,
    delivery_attempts smallint DEFAULT 0,
    last_delivery_error text,
    recipient_type text DEFAULT 'individual'::text NOT NULL,
    target_department_ids uuid[],
    acknowledgement_status text DEFAULT 'pending'::text NOT NULL,
    acknowledged_at timestamp with time zone,
    acknowledgement_action text,
    fallback_status text DEFAULT 'not_applicable'::text NOT NULL,
    fallback_reason text,
    fallback_updated_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now(),
    fallback_due_at timestamp with time zone,
    CONSTRAINT notification_recipient_ack_action_valid CHECK (((acknowledgement_action IS NULL) OR (acknowledgement_action = ANY (ARRAY['destination_open'::text, 'explicit_ack'::text])))),
    CONSTRAINT notification_recipient_ack_status_valid CHECK ((acknowledgement_status = ANY (ARRAY['pending'::text, 'acknowledged'::text]))),
    CONSTRAINT notification_recipient_delivery_attempts_check CHECK ((delivery_attempts >= 0)),
    CONSTRAINT notification_recipient_delivery_status_check CHECK ((delivery_status = ANY (ARRAY['pending'::text, 'delivered'::text, 'failed'::text]))),
    CONSTRAINT notification_recipient_fallback_reason_valid CHECK (((fallback_reason IS NULL) OR (fallback_reason = ANY (ARRAY['live_only_policy'::text, 'no_push_target'::text, 'recipient_ineligible'::text, 'recipient_online'::text, 'suppressed_by_preference'::text, 'sse_receipt_confirmed'::text, 'acknowledged_before_fallback'::text, 'connection_unresponsive'::text, 'delivery_error'::text])))),
    CONSTRAINT notification_recipient_fallback_status_valid CHECK ((fallback_status = ANY (ARRAY['not_applicable'::text, 'queued'::text, 'sent'::text, 'skipped'::text, 'failed'::text]))),
    CONSTRAINT notification_recipient_recipient_type_check CHECK ((recipient_type = ANY (ARRAY['individual'::text, 'department'::text])))
);


--
-- Name: TABLE notification_recipient; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON TABLE notification.notification_recipient IS 'Links notifications to employees with delivery and read tracking';


--
-- Name: COLUMN notification_recipient.read_status; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.notification_recipient.read_status IS 'Whether the notification has been read by the employee. When set to true, delivery_status is automatically updated to delivered.';


--
-- Name: COLUMN notification_recipient.delivery_status; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.notification_recipient.delivery_status IS 'pending = awaiting delivery, delivered = sent via SSE or fallback, failed = all delivery attempts failed. Auto-updated to delivered when notification is marked as read.';


--
-- Name: COLUMN notification_recipient.recipient_type; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.notification_recipient.recipient_type IS 'How recipient was targeted: individual (direct to employee_id) or department (resolved from department membership)';


--
-- Name: COLUMN notification_recipient.target_department_ids; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.notification_recipient.target_department_ids IS 'If sent to department, stores resolved department IDs for audit trail';


--
-- Name: COLUMN notification_recipient.acknowledgement_status; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.notification_recipient.acknowledgement_status IS 'Authoritative unread signal. pending = not yet acknowledged, acknowledged = destination opened or explicitly acknowledged. Frontend unread counts MUST derive from this field.';


--
-- Name: COLUMN notification_recipient.acknowledgement_action; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.notification_recipient.acknowledgement_action IS 'How the notification was acknowledged: destination_open (user navigated to the linked resource) or explicit_ack (user dismissed via explicit action). Popup display alone does NOT acknowledge.';


--
-- Name: COLUMN notification_recipient.fallback_status; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.notification_recipient.fallback_status IS 'Latest offline delivery outcome summary: not_applicable, queued, sent, skipped, failed.';


--
-- Name: COLUMN notification_recipient.fallback_reason; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.notification_recipient.fallback_reason IS 'Why fallback was queued, skipped, sent, or failed. Values: live_only_policy, no_push_target, recipient_ineligible, recipient_online, suppressed_by_preference, sse_receipt_confirmed, acknowledged_before_fallback, connection_unresponsive, delivery_error.';


--
-- Name: COLUMN notification_recipient.fallback_due_at; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.notification_recipient.fallback_due_at IS 'Deadline for delayed rescue push when SSE delivery is ambiguous. NULL when no rescue job is queued.';


--
-- Name: personal_preference; Type: TABLE; Schema: notification; Owner: -
--

CREATE TABLE notification.personal_preference (
    organization_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    dnd_enabled boolean DEFAULT false NOT NULL,
    dnd_start time without time zone,
    dnd_end time without time zone,
    muted_domains text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT muted_domains_valid CHECK ((muted_domains <@ ARRAY['chat'::text, 'projects'::text, 'docs'::text, 'crm'::text, 'hr'::text, 'support'::text, 'finance'::text, 'system'::text]))
);


--
-- Name: TABLE personal_preference; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON TABLE notification.personal_preference IS 'Global notification preferences per employee. Controls DND schedule and domain-level muting.';


--
-- Name: COLUMN personal_preference.dnd_enabled; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.personal_preference.dnd_enabled IS 'When true, push notifications are suppressed during dnd_start..dnd_end window. SSE still delivered.';


--
-- Name: COLUMN personal_preference.muted_domains; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.personal_preference.muted_domains IS 'Domains for which the employee will not receive push notifications. SSE delivery still occurs for real-time UI updates.';


--
-- Name: presence_visibility; Type: TABLE; Schema: notification; Owner: -
--

CREATE TABLE notification.presence_visibility (
    organization_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    visibility_mode text DEFAULT 'everyone'::text NOT NULL,
    custom_status_text text,
    custom_status_emoji text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT visibility_mode_valid CHECK ((visibility_mode = ANY (ARRAY['everyone'::text, 'departments'::text, 'offline'::text])))
);


--
-- Name: TABLE presence_visibility; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON TABLE notification.presence_visibility IS 'Per-employee presence privacy controls determining who can view status and custom presence messaging.';


--
-- Name: COLUMN presence_visibility.visibility_mode; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.presence_visibility.visibility_mode IS 'Visibility mode. Allowed values: everyone, departments, offline. Mirrors rpc.v1.VisibilityMode enum.';


--
-- Name: COLUMN presence_visibility.custom_status_text; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.presence_visibility.custom_status_text IS 'Optional custom status message (e.g., "Heads down coding until 3pm").';


--
-- Name: COLUMN presence_visibility.custom_status_emoji; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.presence_visibility.custom_status_emoji IS 'Optional single emoji associated with custom status.';


--
-- Name: push_token; Type: TABLE; Schema: notification; Owner: -
--

CREATE TABLE notification.push_token (
    token_id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    device_identifier text NOT NULL,
    fcm_token text NOT NULL,
    permission_state text DEFAULT 'prompt'::text NOT NULL,
    endpoint text NOT NULL,
    keys jsonb NOT NULL,
    user_agent text NOT NULL,
    registered_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    is_valid boolean DEFAULT true NOT NULL,
    token_metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    token_type text DEFAULT 'fcm'::text NOT NULL,
    CONSTRAINT permission_state_valid CHECK ((permission_state = ANY (ARRAY['granted'::text, 'denied'::text, 'prompt'::text]))),
    CONSTRAINT push_token_token_type_valid CHECK ((token_type = ANY (ARRAY['fcm'::text, 'apns_voip'::text, 'web_push'::text])))
);


--
-- Name: TABLE push_token; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON TABLE notification.push_token IS 'Stores FCM push tokens for browser and device notifications. One employee can register multiple devices.';


--
-- Name: COLUMN push_token.permission_state; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.push_token.permission_state IS 'Browser notification permission state. Allowed values: granted, denied, prompt. Mirrors rpc.v1.PermissionState enum.';


--
-- Name: COLUMN push_token.keys; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.push_token.keys IS 'Web push subscription keys (p256dh, auth) stored as JSONB for encrypted payload delivery.';


--
-- Name: COLUMN push_token.token_metadata; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.push_token.token_metadata IS 'Device facts that do not key a row: platform (ios/android/web), deliveryProvider, and nativeCallCapable (whether this device build and its permissions support the native call tier, driving tier-A vs tier-B routing).';


--
-- Name: COLUMN push_token.token_type; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.push_token.token_type IS 'Which provider token this row carries: fcm (Firebase, routine notifications and the Android call transport), apns_voip (direct APNs VoIP push, the iOS call transport), web_push (browser). One row per type per device_identifier.';


--
-- Name: resource_subscription; Type: TABLE; Schema: notification; Owner: -
--

CREATE TABLE notification.resource_subscription (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    resource_domain text NOT NULL,
    resource_id uuid NOT NULL,
    subscription_state text DEFAULT 'active'::text NOT NULL,
    preference_level text DEFAULT 'all'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT resource_subscription_domain_valid CHECK ((resource_domain = ANY (ARRAY['task'::text, 'document'::text, 'channel'::text, 'calendar_event'::text]))),
    CONSTRAINT resource_subscription_preference_valid CHECK ((preference_level = ANY (ARRAY['all'::text, 'mentions'::text, 'muted'::text]))),
    CONSTRAINT resource_subscription_state_valid CHECK ((subscription_state = ANY (ARRAY['active'::text, 'unfollowed'::text])))
);


--
-- Name: TABLE resource_subscription; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON TABLE notification.resource_subscription IS 'Notification-owned V2 subscription state for parent resources such as tasks, documents, and channels.';


--
-- Name: COLUMN resource_subscription.subscription_state; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.resource_subscription.subscription_state IS 'active means routine subscription eligibility exists; unfollowed explicitly suppresses routine parent-resource subscription eligibility.';


--
-- Name: COLUMN resource_subscription.preference_level; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.resource_subscription.preference_level IS 'Routine delivery preference for subscribed activity on the parent resource. direct-targeted events may still bypass muted according to V2 policy.';


--
-- Name: resource_subscription_reason; Type: TABLE; Schema: notification; Owner: -
--

CREATE TABLE notification.resource_subscription_reason (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    subscription_id uuid NOT NULL,
    reason_type text NOT NULL,
    reason_ref_type text,
    reason_ref_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT resource_subscription_reason_type_valid CHECK ((reason_type = ANY (ARRAY['creator'::text, 'reporter'::text, 'assignee'::text, 'manual_follow'::text, 'commented'::text, 'mentioned_auto'::text, 'system'::text])))
);


--
-- Name: TABLE resource_subscription_reason; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON TABLE notification.resource_subscription_reason IS 'Explains why a V2 parent-resource subscription exists without collapsing multiple independent reasons into one field.';


--
-- Name: COLUMN resource_subscription_reason.reason_ref_type; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.resource_subscription_reason.reason_ref_type IS 'Optional discriminator for the referenced cause, such as comment, assignment, or system job.';


--
-- Name: COLUMN resource_subscription_reason.reason_ref_id; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.resource_subscription_reason.reason_ref_id IS 'Optional ID of the entity that caused the subscription reason. NULL when the reason has no concrete backing row.';


--
-- Name: resource_surface; Type: TABLE; Schema: notification; Owner: -
--

CREATE TABLE notification.resource_surface (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    parent_domain text NOT NULL,
    parent_resource_id uuid NOT NULL,
    surface_type text NOT NULL,
    surface_domain text NOT NULL,
    surface_resource_id uuid NOT NULL,
    inherits_subscription boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT resource_surface_domain_valid CHECK ((surface_domain = ANY (ARRAY['chat_channel'::text, 'document'::text, 'document_comment_thread'::text]))),
    CONSTRAINT resource_surface_parent_domain_valid CHECK ((parent_domain = ANY (ARRAY['task'::text, 'document'::text]))),
    CONSTRAINT resource_surface_type_valid CHECK ((surface_type = ANY (ARRAY['task_discussion'::text, 'task_description'::text, 'document_comments'::text])))
);


--
-- Name: TABLE resource_surface; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON TABLE notification.resource_surface IS 'Maps task/document child collaboration surfaces back to their parent resource for V2 subscription inheritance.';


--
-- Name: COLUMN resource_surface.inherits_subscription; Type: COMMENT; Schema: notification; Owner: -
--

COMMENT ON COLUMN notification.resource_surface.inherits_subscription IS 'Future-proofing flag that allows a mapped surface to opt out of parent subscription inheritance. V2 defaults to true.';


--
-- Name: department; Type: TABLE; Schema: organization; Owner: -
--

CREATE TABLE organization.department (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    parent_department_id uuid,
    member_count integer DEFAULT 0 NOT NULL,
    manager_count integer DEFAULT 0 NOT NULL,
    child_count integer DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT department_child_count_check CHECK ((child_count >= 0)),
    CONSTRAINT department_manager_count_check CHECK ((manager_count >= 0)),
    CONSTRAINT department_member_count_check CHECK ((member_count >= 0)),
    CONSTRAINT no_self_reference CHECK (((parent_department_id IS NULL) OR (parent_department_id <> id)))
);


--
-- Name: department_member; Type: TABLE; Schema: organization; Owner: -
--

CREATE TABLE organization.department_member (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    department_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    role text DEFAULT 'member'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT department_member_role_check CHECK ((role = ANY (ARRAY['member'::text, 'manager'::text])))
);


--
-- Name: COLUMN department_member.role; Type: COMMENT; Schema: organization; Owner: -
--

COMMENT ON COLUMN organization.department_member.role IS 'Department membership role: member, manager. MUST align with backend constants in internal/department/constants.go and frontend TypeScript types in packages/apis/src/department.ts';


--
-- Name: employee; Type: TABLE; Schema: organization; Owner: -
--

CREATE TABLE organization.employee (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    given_name text NOT NULL,
    family_name text NOT NULL,
    email text DEFAULT ''::text NOT NULL,
    hire_date date,
    date_of_birth date,
    phone_number text,
    home_address text,
    additional_info jsonb,
    is_active boolean DEFAULT true NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: default_role; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.default_role (
    id text NOT NULL,
    display_name text NOT NULL,
    description text NOT NULL,
    is_system boolean DEFAULT false NOT NULL
);


--
-- Name: TABLE default_role; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.default_role IS 'Template roles that get copied to iam.role when a new organization is created. is_system=true roles cannot be deleted by org admins.';


--
-- Name: default_role_permission; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.default_role_permission (
    role_id text NOT NULL,
    permission_id text NOT NULL
);


--
-- Name: TABLE default_role_permission; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.default_role_permission IS 'Maps default roles to permissions. Copied to iam.role_permission for new organizations.';


--
-- Name: organization; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organization (
    id uuid DEFAULT uuidv7() NOT NULL,
    company_name text NOT NULL,
    subdomain character varying(63) NOT NULL,
    client_id text,
    status text DEFAULT 'active'::text NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT organization_status_check CHECK ((status = ANY (ARRAY['active'::text, 'suspended'::text, 'deleted'::text])))
);


--
-- Name: COLUMN organization.status; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON COLUMN public.organization.status IS 'Organization lifecycle status: active, suspended, deleted. MUST align with backend constants in internal/organization/constants.go and frontend TypeScript types in packages/apis/src/organization.ts';


--
-- Name: permission; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.permission (
    id text NOT NULL,
    domain text NOT NULL,
    description text NOT NULL
);


--
-- Name: TABLE permission; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.permission IS 'System-defined permission registry. Reference table replicated to all nodes. Permission IDs follow <domain>.<action> format. Rows are immutable at runtime — only modified by migrations.';


--
-- Name: call_artifact; Type: TABLE; Schema: voice; Owner: -
--

CREATE TABLE voice.call_artifact (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    call_session_id uuid NOT NULL,
    artifact_type text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    file_id uuid,
    mime_type text,
    duration_ms bigint,
    storage_bytes bigint,
    provider text,
    provider_job_id text,
    error_code text,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT voice_artifact_failed_requires_error CHECK (((status <> 'failed'::text) OR (error_code IS NOT NULL))),
    CONSTRAINT voice_artifact_provider_valid CHECK (((provider IS NULL) OR (provider = ANY (ARRAY['livekit_egress'::text, 'transcription_worker'::text])))),
    CONSTRAINT voice_artifact_ready_requires_file CHECK (((status <> 'ready'::text) OR (file_id IS NOT NULL))),
    CONSTRAINT voice_artifact_status_valid CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'ready'::text, 'unavailable'::text, 'failed'::text]))),
    CONSTRAINT voice_artifact_type_valid CHECK ((artifact_type = ANY (ARRAY['recording'::text, 'transcript'::text])))
);


--
-- Name: TABLE call_artifact; Type: COMMENT; Schema: voice; Owner: -
--

COMMENT ON TABLE voice.call_artifact IS 'Recording and transcript artifact lifecycle records for voice calls.';


--
-- Name: call_invitation; Type: TABLE; Schema: voice; Owner: -
--

CREATE TABLE voice.call_invitation (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    call_session_id uuid NOT NULL,
    inviter_employee_id uuid NOT NULL,
    invitee_employee_id uuid NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    notification_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    responded_at timestamp with time zone,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT voice_invitation_response_time_valid CHECK ((((status = 'pending'::text) AND (responded_at IS NULL)) OR ((status <> 'pending'::text) AND (responded_at IS NOT NULL)))),
    CONSTRAINT voice_invitation_status_valid CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'declined'::text, 'expired'::text, 'revoked'::text])))
);


--
-- Name: TABLE call_invitation; Type: COMMENT; Schema: voice; Owner: -
--

COMMENT ON TABLE voice.call_invitation IS 'Voice call invitation records. Invitations do not grant chat room access by themselves.';


--
-- Name: call_participant; Type: TABLE; Schema: voice; Owner: -
--

CREATE TABLE voice.call_participant (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    call_session_id uuid NOT NULL,
    employee_id uuid NOT NULL,
    invited_by_employee_id uuid,
    role text DEFAULT 'participant'::text NOT NULL,
    state text DEFAULT 'joining'::text NOT NULL,
    livekit_identity text NOT NULL,
    joined_at timestamp with time zone,
    left_at timestamp with time zone,
    last_seen_at timestamp with time zone,
    disconnect_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT voice_participant_joined_at_valid CHECK (((state <> ALL (ARRAY['joined'::text, 'disconnected'::text, 'left'::text])) OR (joined_at IS NOT NULL))),
    CONSTRAINT voice_participant_left_at_valid CHECK (((state <> ALL (ARRAY['left'::text, 'declined'::text, 'removed'::text])) OR (left_at IS NOT NULL))),
    CONSTRAINT voice_participant_role_valid CHECK ((role = ANY (ARRAY['initiator'::text, 'participant'::text]))),
    CONSTRAINT voice_participant_state_valid CHECK ((state = ANY (ARRAY['invited'::text, 'ringing'::text, 'joining'::text, 'joined'::text, 'disconnected'::text, 'left'::text, 'declined'::text, 'removed'::text])))
);


--
-- Name: TABLE call_participant; Type: COMMENT; Schema: voice; Owner: -
--

COMMENT ON TABLE voice.call_participant IS 'Employee-level voice call participation records and LiveKit identity mapping.';


--
-- Name: call_session; Type: TABLE; Schema: voice; Owner: -
--

CREATE TABLE voice.call_session (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    channel_id uuid NOT NULL,
    initiator_employee_id uuid NOT NULL,
    livekit_room_name text NOT NULL,
    state text DEFAULT 'ringing'::text NOT NULL,
    outcome text,
    recording_policy text DEFAULT 'not_allowed'::text NOT NULL,
    recording_status text DEFAULT 'unavailable'::text NOT NULL,
    transcript_status text DEFAULT 'unavailable'::text NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    answered_at timestamp with time zone,
    ended_at timestamp with time zone,
    ended_by_employee_id uuid,
    ended_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    ring_deadline_at timestamp with time zone,
    CONSTRAINT voice_call_ended_requires_outcome CHECK (((state <> 'ended'::text) OR ((outcome IS NOT NULL) AND (ended_at IS NOT NULL)))),
    CONSTRAINT voice_call_outcome_valid CHECK (((outcome IS NULL) OR (outcome = ANY (ARRAY['answered'::text, 'missed'::text, 'declined'::text, 'cancelled'::text, 'completed'::text])))),
    CONSTRAINT voice_call_recording_policy_valid CHECK ((recording_policy = ANY (ARRAY['not_allowed'::text, 'allowed'::text, 'required'::text]))),
    CONSTRAINT voice_call_recording_status_valid CHECK ((recording_status = ANY (ARRAY['unavailable'::text, 'pending'::text, 'processing'::text, 'ready'::text, 'failed'::text]))),
    CONSTRAINT voice_call_state_valid CHECK ((state = ANY (ARRAY['ringing'::text, 'active'::text, 'ending'::text, 'ended'::text]))),
    CONSTRAINT voice_call_transcript_status_valid CHECK ((transcript_status = ANY (ARRAY['unavailable'::text, 'pending'::text, 'processing'::text, 'ready'::text, 'failed'::text])))
);


--
-- Name: TABLE call_session; Type: COMMENT; Schema: voice; Owner: -
--

COMMENT ON TABLE voice.call_session IS 'Voice call lifecycle records attached to chat channels. LiveKit tokens are generated on demand and never stored.';


--
-- Name: COLUMN call_session.ring_deadline_at; Type: COMMENT; Schema: voice; Owner: -
--

COMMENT ON COLUMN voice.call_session.ring_deadline_at IS 'When an unanswered ringing call expires. Set on the transition into ringing (started_at + the 45s ring timeout), NULL in every other state. The ring timeout sweep claims rows past this deadline and ends the call missed.';


--
-- Name: voice_message; Type: TABLE; Schema: voice; Owner: -
--

CREATE TABLE voice.voice_message (
    id uuid DEFAULT uuidv7() NOT NULL,
    organization_id uuid NOT NULL,
    channel_id uuid NOT NULL,
    sender_employee_id uuid NOT NULL,
    message_id uuid,
    file_id uuid,
    client_deduplication_key text NOT NULL,
    status text DEFAULT 'requested'::text NOT NULL,
    duration_ms bigint,
    mime_type text NOT NULL,
    codec text,
    waveform_peaks jsonb,
    size_bytes bigint NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    posted_at timestamp with time zone,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT voice_message_codec_valid CHECK (((codec IS NULL) OR (codec = ANY (ARRAY['opus'::text, 'aac'::text])))),
    CONSTRAINT voice_message_duration_positive CHECK (((duration_ms IS NULL) OR (duration_ms > 0))),
    CONSTRAINT voice_message_mime_type_valid CHECK ((mime_type = ANY (ARRAY['audio/webm'::text, 'audio/ogg'::text, 'audio/mp4'::text, 'audio/mpeg'::text, 'audio/wav'::text]))),
    CONSTRAINT voice_message_posted_requires_assets CHECK (((status <> 'posted'::text) OR ((message_id IS NOT NULL) AND (file_id IS NOT NULL) AND (duration_ms IS NOT NULL) AND (posted_at IS NOT NULL)))),
    CONSTRAINT voice_message_size_positive CHECK ((size_bytes > 0)),
    CONSTRAINT voice_message_status_valid CHECK ((status = ANY (ARRAY['requested'::text, 'uploading'::text, 'posted'::text, 'failed'::text, 'cancelled'::text]))),
    CONSTRAINT voice_message_waveform_array CHECK (((waveform_peaks IS NULL) OR (jsonb_typeof(waveform_peaks) = 'array'::text)))
);


--
-- Name: TABLE voice_message; Type: COMMENT; Schema: voice; Owner: -
--

COMMENT ON TABLE voice.voice_message IS 'Voice-message upload state and playback metadata linked to chat timeline messages.';


--
-- Name: attendee pk_calendar_attendee; Type: CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.attendee
    ADD CONSTRAINT pk_calendar_attendee PRIMARY KEY (organization_id, id);


--
-- Name: audit_entry pk_calendar_audit_entry; Type: CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.audit_entry
    ADD CONSTRAINT pk_calendar_audit_entry PRIMARY KEY (organization_id, id);


--
-- Name: booking_link pk_calendar_booking_link; Type: CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.booking_link
    ADD CONSTRAINT pk_calendar_booking_link PRIMARY KEY (organization_id, id);


--
-- Name: check_in pk_calendar_check_in; Type: CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.check_in
    ADD CONSTRAINT pk_calendar_check_in PRIMARY KEY (organization_id, id);


--
-- Name: delegation pk_calendar_delegation; Type: CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.delegation
    ADD CONSTRAINT pk_calendar_delegation PRIMARY KEY (organization_id, id);


--
-- Name: event pk_calendar_event; Type: CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.event
    ADD CONSTRAINT pk_calendar_event PRIMARY KEY (organization_id, id);


--
-- Name: event_reminder pk_calendar_event_reminder; Type: CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.event_reminder
    ADD CONSTRAINT pk_calendar_event_reminder PRIMARY KEY (organization_id, id);


--
-- Name: resource pk_calendar_resource; Type: CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.resource
    ADD CONSTRAINT pk_calendar_resource PRIMARY KEY (organization_id, id);


--
-- Name: resource_acl pk_calendar_resource_acl; Type: CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.resource_acl
    ADD CONSTRAINT pk_calendar_resource_acl PRIMARY KEY (organization_id, id);


--
-- Name: resource_booking pk_calendar_resource_booking; Type: CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.resource_booking
    ADD CONSTRAINT pk_calendar_resource_booking PRIMARY KEY (organization_id, id);


--
-- Name: working_hours pk_calendar_working_hours; Type: CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.working_hours
    ADD CONSTRAINT pk_calendar_working_hours PRIMARY KEY (organization_id, id);


--
-- Name: recurrence_exception pk_recurrence_exception; Type: CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.recurrence_exception
    ADD CONSTRAINT pk_recurrence_exception PRIMARY KEY (organization_id, id);


--
-- Name: attendee uq_attendee_event_employee; Type: CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.attendee
    ADD CONSTRAINT uq_attendee_event_employee UNIQUE (organization_id, event_id, employee_id);


--
-- Name: booking_link uq_booking_link_token; Type: CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.booking_link
    ADD CONSTRAINT uq_booking_link_token UNIQUE (organization_id, token);


--
-- Name: event_reminder uq_calendar_event_reminder_event_employee; Type: CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.event_reminder
    ADD CONSTRAINT uq_calendar_event_reminder_event_employee UNIQUE (organization_id, event_id, attendee_employee_id);


--
-- Name: check_in uq_check_in_event_employee; Type: CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.check_in
    ADD CONSTRAINT uq_check_in_event_employee UNIQUE (organization_id, event_id, employee_id);


--
-- Name: delegation uq_delegation_owner_delegate; Type: CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.delegation
    ADD CONSTRAINT uq_delegation_owner_delegate UNIQUE (organization_id, owner_id, delegate_id);


--
-- Name: recurrence_exception uq_recurrence_exception_instance; Type: CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.recurrence_exception
    ADD CONSTRAINT uq_recurrence_exception_instance UNIQUE (organization_id, series_id, original_start_time);


--
-- Name: working_hours uq_working_hours_employee_day; Type: CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.working_hours
    ADD CONSTRAINT uq_working_hours_employee_day UNIQUE (organization_id, employee_id, day_of_week);


--
-- Name: channel_membership channel_membership_pkey; Type: CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.channel_membership
    ADD CONSTRAINT channel_membership_pkey PRIMARY KEY (organization_id, id);


--
-- Name: channel channel_pkey; Type: CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.channel
    ADD CONSTRAINT channel_pkey PRIMARY KEY (organization_id, id);


--
-- Name: message message_pkey; Type: CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.message
    ADD CONSTRAINT message_pkey PRIMARY KEY (organization_id, id);


--
-- Name: reaction reaction_pkey; Type: CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.reaction
    ADD CONSTRAINT reaction_pkey PRIMARY KEY (organization_id, id);


--
-- Name: typing_indicator typing_indicator_pkey; Type: CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.typing_indicator
    ADD CONSTRAINT typing_indicator_pkey PRIMARY KEY (organization_id, id);


--
-- Name: channel unique_channel_slug_per_org; Type: CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.channel
    ADD CONSTRAINT unique_channel_slug_per_org UNIQUE (organization_id, title_slug);


--
-- Name: channel_membership unique_membership; Type: CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.channel_membership
    ADD CONSTRAINT unique_membership UNIQUE (organization_id, channel_id, employee_id);


--
-- Name: reaction unique_reaction; Type: CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.reaction
    ADD CONSTRAINT unique_reaction UNIQUE (organization_id, message_id, employee_id, emoji_code);


--
-- Name: typing_indicator unique_typing; Type: CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.typing_indicator
    ADD CONSTRAINT unique_typing UNIQUE (organization_id, channel_id, employee_id);


--
-- Name: user_chat_config unique_user_chat_config; Type: CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.user_chat_config
    ADD CONSTRAINT unique_user_chat_config UNIQUE (organization_id, employee_id);


--
-- Name: user_chat_config user_chat_config_pkey; Type: CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.user_chat_config
    ADD CONSTRAINT user_chat_config_pkey PRIMARY KEY (organization_id, id);


--
-- Name: channel_task_destination channel_task_destination_pkey; Type: CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.channel_task_destination
    ADD CONSTRAINT channel_task_destination_pkey PRIMARY KEY (organization_id, channel_id);


--
-- Name: custom_field_definition custom_field_definition_pkey; Type: CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.custom_field_definition
    ADD CONSTRAINT custom_field_definition_pkey PRIMARY KEY (organization_id, id);


--
-- Name: custom_field_value custom_field_value_pkey; Type: CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.custom_field_value
    ADD CONSTRAINT custom_field_value_pkey PRIMARY KEY (organization_id, id);


--
-- Name: evidence_requirement evidence_requirement_pkey; Type: CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.evidence_requirement
    ADD CONSTRAINT evidence_requirement_pkey PRIMARY KEY (organization_id, id);


--
-- Name: evidence_submission evidence_submission_pkey; Type: CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.evidence_submission
    ADD CONSTRAINT evidence_submission_pkey PRIMARY KEY (organization_id, id);


--
-- Name: project_membership project_membership_pkey; Type: CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.project_membership
    ADD CONSTRAINT project_membership_pkey PRIMARY KEY (organization_id, id);


--
-- Name: project project_pkey; Type: CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.project
    ADD CONSTRAINT project_pkey PRIMARY KEY (organization_id, id);


--
-- Name: project_state project_state_pkey; Type: CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.project_state
    ADD CONSTRAINT project_state_pkey PRIMARY KEY (organization_id, id);


--
-- Name: ritual_definition_assignee ritual_definition_assignee_pkey; Type: CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.ritual_definition_assignee
    ADD CONSTRAINT ritual_definition_assignee_pkey PRIMARY KEY (organization_id, id);


--
-- Name: ritual_definition_department_pool ritual_definition_department_pool_pkey; Type: CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.ritual_definition_department_pool
    ADD CONSTRAINT ritual_definition_department_pool_pkey PRIMARY KEY (organization_id, id);


--
-- Name: ritual_definition ritual_definition_pkey; Type: CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.ritual_definition
    ADD CONSTRAINT ritual_definition_pkey PRIMARY KEY (organization_id, id);


--
-- Name: saved_view saved_view_pkey; Type: CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.saved_view
    ADD CONSTRAINT saved_view_pkey PRIMARY KEY (organization_id, id);


--
-- Name: task_assignee task_assignee_pkey; Type: CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.task_assignee
    ADD CONSTRAINT task_assignee_pkey PRIMARY KEY (organization_id, id);


--
-- Name: task_level task_level_pkey; Type: CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.task_level
    ADD CONSTRAINT task_level_pkey PRIMARY KEY (organization_id, id);


--
-- Name: task task_pkey; Type: CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.task
    ADD CONSTRAINT task_pkey PRIMARY KEY (organization_id, id);


--
-- Name: custom_field_definition unique_field_name; Type: CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.custom_field_definition
    ADD CONSTRAINT unique_field_name UNIQUE (organization_id, project_id, name);


--
-- Name: task_level unique_level_depth; Type: CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.task_level
    ADD CONSTRAINT unique_level_depth UNIQUE (organization_id, project_id, depth);


--
-- Name: task_level unique_level_name; Type: CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.task_level
    ADD CONSTRAINT unique_level_name UNIQUE (organization_id, project_id, name);


--
-- Name: project unique_project_key; Type: CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.project
    ADD CONSTRAINT unique_project_key UNIQUE (organization_id, key);


--
-- Name: project_membership unique_project_member; Type: CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.project_membership
    ADD CONSTRAINT unique_project_member UNIQUE (organization_id, project_id, employee_id);


--
-- Name: project_state unique_state_name; Type: CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.project_state
    ADD CONSTRAINT unique_state_name UNIQUE (organization_id, project_id, name);


--
-- Name: project_state unique_state_position; Type: CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.project_state
    ADD CONSTRAINT unique_state_position UNIQUE (organization_id, project_id, "position");


--
-- Name: task_assignee unique_task_assignee; Type: CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.task_assignee
    ADD CONSTRAINT unique_task_assignee UNIQUE (organization_id, task_id, employee_id, role);


--
-- Name: custom_field_value unique_task_field; Type: CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.custom_field_value
    ADD CONSTRAINT unique_task_field UNIQUE (organization_id, task_id, field_definition_id);


--
-- Name: task unique_task_identifier; Type: CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.task
    ADD CONSTRAINT unique_task_identifier UNIQUE (organization_id, project_id, identifier);


--
-- Name: ritual_definition_assignee uq_rda_unique_assignment; Type: CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.ritual_definition_assignee
    ADD CONSTRAINT uq_rda_unique_assignment UNIQUE (organization_id, ritual_definition_id, employee_id);


--
-- Name: ritual_definition_department_pool uq_rddp_unique; Type: CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.ritual_definition_department_pool
    ADD CONSTRAINT uq_rddp_unique UNIQUE (organization_id, ritual_definition_id, department_id);


--
-- Name: workflow_rule_execution workflow_rule_execution_pkey; Type: CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.workflow_rule_execution
    ADD CONSTRAINT workflow_rule_execution_pkey PRIMARY KEY (organization_id, id);


--
-- Name: workflow_rule workflow_rule_pkey; Type: CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.workflow_rule
    ADD CONSTRAINT workflow_rule_pkey PRIMARY KEY (organization_id, id);


--
-- Name: account_deletion pk_compliance_account_deletion; Type: CONSTRAINT; Schema: compliance; Owner: -
--

ALTER TABLE ONLY compliance.account_deletion
    ADD CONSTRAINT pk_compliance_account_deletion PRIMARY KEY (organization_id, id);


--
-- Name: block pk_compliance_block; Type: CONSTRAINT; Schema: compliance; Owner: -
--

ALTER TABLE ONLY compliance.block
    ADD CONSTRAINT pk_compliance_block PRIMARY KEY (organization_id, id);


--
-- Name: content_report pk_compliance_content_report; Type: CONSTRAINT; Schema: compliance; Owner: -
--

ALTER TABLE ONLY compliance.content_report
    ADD CONSTRAINT pk_compliance_content_report PRIMARY KEY (organization_id, id);


--
-- Name: removal_request pk_compliance_removal_request; Type: CONSTRAINT; Schema: compliance; Owner: -
--

ALTER TABLE ONLY compliance.removal_request
    ADD CONSTRAINT pk_compliance_removal_request PRIMARY KEY (organization_id, id);


--
-- Name: block uq_compliance_block_pair; Type: CONSTRAINT; Schema: compliance; Owner: -
--

ALTER TABLE ONLY compliance.block
    ADD CONSTRAINT uq_compliance_block_pair UNIQUE (organization_id, blocker_employee_id, blocked_employee_id);


--
-- Name: comment comment_pkey; Type: CONSTRAINT; Schema: docs; Owner: -
--

ALTER TABLE ONLY docs.comment
    ADD CONSTRAINT comment_pkey PRIMARY KEY (organization_id, id);


--
-- Name: comment_reply comment_reply_pkey; Type: CONSTRAINT; Schema: docs; Owner: -
--

ALTER TABLE ONLY docs.comment_reply
    ADD CONSTRAINT comment_reply_pkey PRIMARY KEY (organization_id, id);


--
-- Name: document_access document_access_pkey; Type: CONSTRAINT; Schema: docs; Owner: -
--

ALTER TABLE ONLY docs.document_access
    ADD CONSTRAINT document_access_pkey PRIMARY KEY (organization_id, id);


--
-- Name: document_editor document_editor_pkey; Type: CONSTRAINT; Schema: docs; Owner: -
--

ALTER TABLE ONLY docs.document_editor
    ADD CONSTRAINT document_editor_pkey PRIMARY KEY (organization_id, document_id, employee_id);


--
-- Name: document document_pkey; Type: CONSTRAINT; Schema: docs; Owner: -
--

ALTER TABLE ONLY docs.document
    ADD CONSTRAINT document_pkey PRIMARY KEY (organization_id, id);


--
-- Name: document_reaction document_reaction_pkey; Type: CONSTRAINT; Schema: docs; Owner: -
--

ALTER TABLE ONLY docs.document_reaction
    ADD CONSTRAINT document_reaction_pkey PRIMARY KEY (organization_id, id);


--
-- Name: document_slug_history document_slug_history_pkey; Type: CONSTRAINT; Schema: docs; Owner: -
--

ALTER TABLE ONLY docs.document_slug_history
    ADD CONSTRAINT document_slug_history_pkey PRIMARY KEY (organization_id, id);


--
-- Name: document_version document_version_pkey; Type: CONSTRAINT; Schema: docs; Owner: -
--

ALTER TABLE ONLY docs.document_version
    ADD CONSTRAINT document_version_pkey PRIMARY KEY (organization_id, id);


--
-- Name: section_embed section_embed_pkey; Type: CONSTRAINT; Schema: docs; Owner: -
--

ALTER TABLE ONLY docs.section_embed
    ADD CONSTRAINT section_embed_pkey PRIMARY KEY (organization_id, id);


--
-- Name: document unique_document_slug; Type: CONSTRAINT; Schema: docs; Owner: -
--

ALTER TABLE ONLY docs.document
    ADD CONSTRAINT unique_document_slug UNIQUE (organization_id, slug);


--
-- Name: document_reaction unique_employee_reaction; Type: CONSTRAINT; Schema: docs; Owner: -
--

ALTER TABLE ONLY docs.document_reaction
    ADD CONSTRAINT unique_employee_reaction UNIQUE (organization_id, document_id, employee_id);


--
-- Name: document_access unique_grantee; Type: CONSTRAINT; Schema: docs; Owner: -
--

ALTER TABLE ONLY docs.document_access
    ADD CONSTRAINT unique_grantee UNIQUE (organization_id, document_id, grantee_type, grantee_id);


--
-- Name: document_slug_history unique_old_slug; Type: CONSTRAINT; Schema: docs; Owner: -
--

ALTER TABLE ONLY docs.document_slug_history
    ADD CONSTRAINT unique_old_slug UNIQUE (organization_id, old_slug);


--
-- Name: document_version unique_version_number; Type: CONSTRAINT; Schema: docs; Owner: -
--

ALTER TABLE ONLY docs.document_version
    ADD CONSTRAINT unique_version_number UNIQUE (organization_id, document_id, version_number);


--
-- Name: file_access_rule file_access_rule_pkey; Type: CONSTRAINT; Schema: files; Owner: -
--

ALTER TABLE ONLY files.file_access_rule
    ADD CONSTRAINT file_access_rule_pkey PRIMARY KEY (organization_id, id);


--
-- Name: file_content_index file_content_index_pkey; Type: CONSTRAINT; Schema: files; Owner: -
--

ALTER TABLE ONLY files.file_content_index
    ADD CONSTRAINT file_content_index_pkey PRIMARY KEY (organization_id, id);


--
-- Name: file_deletion_log file_deletion_log_pkey; Type: CONSTRAINT; Schema: files; Owner: -
--

ALTER TABLE ONLY files.file_deletion_log
    ADD CONSTRAINT file_deletion_log_pkey PRIMARY KEY (organization_id, id);


--
-- Name: file_metadata file_metadata_pkey; Type: CONSTRAINT; Schema: files; Owner: -
--

ALTER TABLE ONLY files.file_metadata
    ADD CONSTRAINT file_metadata_pkey PRIMARY KEY (organization_id, id);


--
-- Name: file_pdf_conversion file_pdf_conversion_pkey; Type: CONSTRAINT; Schema: files; Owner: -
--

ALTER TABLE ONLY files.file_pdf_conversion
    ADD CONSTRAINT file_pdf_conversion_pkey PRIMARY KEY (organization_id, id);


--
-- Name: file_quota file_quota_pkey; Type: CONSTRAINT; Schema: files; Owner: -
--

ALTER TABLE ONLY files.file_quota
    ADD CONSTRAINT file_quota_pkey PRIMARY KEY (organization_id);


--
-- Name: file_access_rule unique_file_access; Type: CONSTRAINT; Schema: files; Owner: -
--

ALTER TABLE ONLY files.file_access_rule
    ADD CONSTRAINT unique_file_access UNIQUE (organization_id, file_id);


--
-- Name: file_pdf_conversion unique_file_conversion; Type: CONSTRAINT; Schema: files; Owner: -
--

ALTER TABLE ONLY files.file_pdf_conversion
    ADD CONSTRAINT unique_file_conversion UNIQUE (organization_id, original_file_id);


--
-- Name: file_content_index unique_file_index; Type: CONSTRAINT; Schema: files; Owner: -
--

ALTER TABLE ONLY files.file_content_index
    ADD CONSTRAINT unique_file_index UNIQUE (organization_id, file_id);


--
-- Name: events events_pkey; Type: CONSTRAINT; Schema: flows; Owner: -
--

ALTER TABLE ONLY flows.events
    ADD CONSTRAINT events_pkey PRIMARY KEY (workflow_name_shard, run_id, event_name);


--
-- Name: random random_pkey; Type: CONSTRAINT; Schema: flows; Owner: -
--

ALTER TABLE ONLY flows.random
    ADD CONSTRAINT random_pkey PRIMARY KEY (workflow_name_shard, run_id, rand_key);


--
-- Name: runs runs_pkey; Type: CONSTRAINT; Schema: flows; Owner: -
--

ALTER TABLE ONLY flows.runs
    ADD CONSTRAINT runs_pkey PRIMARY KEY (workflow_name_shard, run_id);


--
-- Name: schedules schedules_pkey; Type: CONSTRAINT; Schema: flows; Owner: -
--

ALTER TABLE ONLY flows.schedules
    ADD CONSTRAINT schedules_pkey PRIMARY KEY (schedule_id);


--
-- Name: steps steps_pkey; Type: CONSTRAINT; Schema: flows; Owner: -
--

ALTER TABLE ONLY flows.steps
    ADD CONSTRAINT steps_pkey PRIMARY KEY (workflow_name_shard, run_id, step_key);


--
-- Name: waits waits_pkey; Type: CONSTRAINT; Schema: flows; Owner: -
--

ALTER TABLE ONLY flows.waits
    ADD CONSTRAINT waits_pkey PRIMARY KEY (workflow_name_shard, run_id, wait_key);


--
-- Name: account_lockout account_lockout_pkey; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.account_lockout
    ADD CONSTRAINT account_lockout_pkey PRIMARY KEY (organization_id, identity_id);


--
-- Name: credential credential_pkey; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.credential
    ADD CONSTRAINT credential_pkey PRIMARY KEY (organization_id, id);


--
-- Name: employee_role employee_role_pkey; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.employee_role
    ADD CONSTRAINT employee_role_pkey PRIMARY KEY (organization_id, employee_id, role_id);


--
-- Name: identity identity_pkey; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.identity
    ADD CONSTRAINT identity_pkey PRIMARY KEY (organization_id, id);


--
-- Name: invitation invitation_pkey; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.invitation
    ADD CONSTRAINT invitation_pkey PRIMARY KEY (id);


--
-- Name: invitation invitation_token_key; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.invitation
    ADD CONSTRAINT invitation_token_key UNIQUE (token);


--
-- Name: password_credential password_credential_pkey; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.password_credential
    ADD CONSTRAINT password_credential_pkey PRIMARY KEY (id);


--
-- Name: password_credential password_credential_user_id_key; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.password_credential
    ADD CONSTRAINT password_credential_user_id_key UNIQUE (user_id);


--
-- Name: password_reset_token password_reset_token_pkey; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.password_reset_token
    ADD CONSTRAINT password_reset_token_pkey PRIMARY KEY (id);


--
-- Name: password_reset_token password_reset_token_token_key; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.password_reset_token
    ADD CONSTRAINT password_reset_token_token_key UNIQUE (token);


--
-- Name: role role_organization_id_name_key; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.role
    ADD CONSTRAINT role_organization_id_name_key UNIQUE (organization_id, name);


--
-- Name: role_permission role_permission_pkey; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.role_permission
    ADD CONSTRAINT role_permission_pkey PRIMARY KEY (organization_id, role_id, permission_id);


--
-- Name: role role_pkey; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.role
    ADD CONSTRAINT role_pkey PRIMARY KEY (organization_id, id);


--
-- Name: session session_pkey; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.session
    ADD CONSTRAINT session_pkey PRIMARY KEY (id);


--
-- Name: session session_token_jti_key; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.session
    ADD CONSTRAINT session_token_jti_key UNIQUE (token_jti);


--
-- Name: sso_identity sso_identity_pkey; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.sso_identity
    ADD CONSTRAINT sso_identity_pkey PRIMARY KEY (id);


--
-- Name: sso_identity sso_identity_provider_provider_user_id_key; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.sso_identity
    ADD CONSTRAINT sso_identity_provider_provider_user_id_key UNIQUE (provider, provider_user_id);


--
-- Name: user_preference unique_employee_preference; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.user_preference
    ADD CONSTRAINT unique_employee_preference UNIQUE (organization_id, employee_id);


--
-- Name: user user_email_key; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam."user"
    ADD CONSTRAINT user_email_key UNIQUE (email);


--
-- Name: user user_pkey; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam."user"
    ADD CONSTRAINT user_pkey PRIMARY KEY (id);


--
-- Name: user_preference user_preference_pkey; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.user_preference
    ADD CONSTRAINT user_preference_pkey PRIMARY KEY (organization_id, id);


--
-- Name: active_connection active_connection_pkey; Type: CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.active_connection
    ADD CONSTRAINT active_connection_pkey PRIMARY KEY (organization_id, employee_id, connection_id);


--
-- Name: active_context active_context_pkey; Type: CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.active_context
    ADD CONSTRAINT active_context_pkey PRIMARY KEY (organization_id, connection_id, context_type, context_id);


--
-- Name: active_listener active_listener_pkey; Type: CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.active_listener
    ADD CONSTRAINT active_listener_pkey PRIMARY KEY (instance_id);


--
-- Name: delivery_attempt delivery_attempt_pkey; Type: CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.delivery_attempt
    ADD CONSTRAINT delivery_attempt_pkey PRIMARY KEY (organization_id, id);


--
-- Name: ephemeral_signal ephemeral_signal_id_unique; Type: CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.ephemeral_signal
    ADD CONSTRAINT ephemeral_signal_id_unique PRIMARY KEY (organization_id, signal_id);


--
-- Name: live_receipt live_receipt_pkey; Type: CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.live_receipt
    ADD CONSTRAINT live_receipt_pkey PRIMARY KEY (organization_id, id);


--
-- Name: notification_batch notification_batch_pkey; Type: CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.notification_batch
    ADD CONSTRAINT notification_batch_pkey PRIMARY KEY (organization_id, id);


--
-- Name: notification_delivery_log notification_delivery_log_pkey; Type: CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.notification_delivery_log
    ADD CONSTRAINT notification_delivery_log_pkey PRIMARY KEY (organization_id, id);


--
-- Name: notification notification_pkey; Type: CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.notification
    ADD CONSTRAINT notification_pkey PRIMARY KEY (organization_id, id);


--
-- Name: notification_recipient notification_recipient_pkey; Type: CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.notification_recipient
    ADD CONSTRAINT notification_recipient_pkey PRIMARY KEY (organization_id, id);


--
-- Name: personal_preference personal_preference_pkey; Type: CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.personal_preference
    ADD CONSTRAINT personal_preference_pkey PRIMARY KEY (organization_id, employee_id);


--
-- Name: presence_visibility presence_visibility_pkey; Type: CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.presence_visibility
    ADD CONSTRAINT presence_visibility_pkey PRIMARY KEY (organization_id, employee_id);


--
-- Name: push_token push_token_token_id_unique; Type: CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.push_token
    ADD CONSTRAINT push_token_token_id_unique PRIMARY KEY (organization_id, token_id);


--
-- Name: push_token push_token_unique; Type: CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.push_token
    ADD CONSTRAINT push_token_unique UNIQUE (organization_id, employee_id, device_identifier, token_type);


--
-- Name: resource_subscription resource_subscription_pkey; Type: CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.resource_subscription
    ADD CONSTRAINT resource_subscription_pkey PRIMARY KEY (organization_id, id);


--
-- Name: resource_subscription_reason resource_subscription_reason_pkey; Type: CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.resource_subscription_reason
    ADD CONSTRAINT resource_subscription_reason_pkey PRIMARY KEY (organization_id, id);


--
-- Name: resource_subscription resource_subscription_unique; Type: CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.resource_subscription
    ADD CONSTRAINT resource_subscription_unique UNIQUE (organization_id, employee_id, resource_domain, resource_id);


--
-- Name: resource_surface resource_surface_parent_unique; Type: CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.resource_surface
    ADD CONSTRAINT resource_surface_parent_unique UNIQUE (organization_id, parent_domain, parent_resource_id, surface_type);


--
-- Name: resource_surface resource_surface_pkey; Type: CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.resource_surface
    ADD CONSTRAINT resource_surface_pkey PRIMARY KEY (organization_id, id);


--
-- Name: resource_surface resource_surface_surface_unique; Type: CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.resource_surface
    ADD CONSTRAINT resource_surface_surface_unique UNIQUE (organization_id, surface_domain, surface_resource_id);


--
-- Name: department_member department_member_pkey; Type: CONSTRAINT; Schema: organization; Owner: -
--

ALTER TABLE ONLY organization.department_member
    ADD CONSTRAINT department_member_pkey PRIMARY KEY (organization_id, id);


--
-- Name: department department_pkey; Type: CONSTRAINT; Schema: organization; Owner: -
--

ALTER TABLE ONLY organization.department
    ADD CONSTRAINT department_pkey PRIMARY KEY (organization_id, id);


--
-- Name: employee employee_pkey; Type: CONSTRAINT; Schema: organization; Owner: -
--

ALTER TABLE ONLY organization.employee
    ADD CONSTRAINT employee_pkey PRIMARY KEY (organization_id, id);


--
-- Name: department_member unique_dept_member; Type: CONSTRAINT; Schema: organization; Owner: -
--

ALTER TABLE ONLY organization.department_member
    ADD CONSTRAINT unique_dept_member UNIQUE (organization_id, department_id, employee_id);


--
-- Name: default_role_permission default_role_permission_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.default_role_permission
    ADD CONSTRAINT default_role_permission_pkey PRIMARY KEY (role_id, permission_id);


--
-- Name: default_role default_role_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.default_role
    ADD CONSTRAINT default_role_pkey PRIMARY KEY (id);


--
-- Name: organization organization_id_client_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization
    ADD CONSTRAINT organization_id_client_id_key UNIQUE (id, client_id);


--
-- Name: organization organization_id_company_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization
    ADD CONSTRAINT organization_id_company_name_key UNIQUE (id, company_name);


--
-- Name: organization organization_id_subdomain_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization
    ADD CONSTRAINT organization_id_subdomain_key UNIQUE (id, subdomain);


--
-- Name: organization organization_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organization
    ADD CONSTRAINT organization_pkey PRIMARY KEY (id);


--
-- Name: permission permission_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.permission
    ADD CONSTRAINT permission_pkey PRIMARY KEY (id);


--
-- Name: call_artifact call_artifact_pkey; Type: CONSTRAINT; Schema: voice; Owner: -
--

ALTER TABLE ONLY voice.call_artifact
    ADD CONSTRAINT call_artifact_pkey PRIMARY KEY (organization_id, id);


--
-- Name: call_invitation call_invitation_pkey; Type: CONSTRAINT; Schema: voice; Owner: -
--

ALTER TABLE ONLY voice.call_invitation
    ADD CONSTRAINT call_invitation_pkey PRIMARY KEY (organization_id, id);


--
-- Name: call_participant call_participant_pkey; Type: CONSTRAINT; Schema: voice; Owner: -
--

ALTER TABLE ONLY voice.call_participant
    ADD CONSTRAINT call_participant_pkey PRIMARY KEY (organization_id, id);


--
-- Name: call_session call_session_pkey; Type: CONSTRAINT; Schema: voice; Owner: -
--

ALTER TABLE ONLY voice.call_session
    ADD CONSTRAINT call_session_pkey PRIMARY KEY (organization_id, id);


--
-- Name: call_artifact voice_artifact_unique; Type: CONSTRAINT; Schema: voice; Owner: -
--

ALTER TABLE ONLY voice.call_artifact
    ADD CONSTRAINT voice_artifact_unique UNIQUE (organization_id, call_session_id, artifact_type);


--
-- Name: voice_message voice_message_dedup_unique; Type: CONSTRAINT; Schema: voice; Owner: -
--

ALTER TABLE ONLY voice.voice_message
    ADD CONSTRAINT voice_message_dedup_unique UNIQUE (organization_id, channel_id, sender_employee_id, client_deduplication_key);


--
-- Name: voice_message voice_message_pkey; Type: CONSTRAINT; Schema: voice; Owner: -
--

ALTER TABLE ONLY voice.voice_message
    ADD CONSTRAINT voice_message_pkey PRIMARY KEY (organization_id, id);


--
-- Name: call_participant voice_participant_unique; Type: CONSTRAINT; Schema: voice; Owner: -
--

ALTER TABLE ONLY voice.call_participant
    ADD CONSTRAINT voice_participant_unique UNIQUE (organization_id, call_session_id, employee_id);


--
-- Name: idx_attendee_org_employee_event; Type: INDEX; Schema: calendar; Owner: -
--

CREATE INDEX idx_attendee_org_employee_event ON calendar.attendee USING btree (organization_id, employee_id, event_id);


--
-- Name: idx_attendee_org_event; Type: INDEX; Schema: calendar; Owner: -
--

CREATE INDEX idx_attendee_org_event ON calendar.attendee USING btree (organization_id, event_id);


--
-- Name: idx_audit_entry_event_time; Type: INDEX; Schema: calendar; Owner: -
--

CREATE INDEX idx_audit_entry_event_time ON calendar.audit_entry USING btree (organization_id, event_id, occurred_at DESC);


--
-- Name: idx_booking_link_owner; Type: INDEX; Schema: calendar; Owner: -
--

CREATE INDEX idx_booking_link_owner ON calendar.booking_link USING btree (organization_id, owner_id, expires_at) WHERE (status = 'active'::text);


--
-- Name: idx_booking_link_token; Type: INDEX; Schema: calendar; Owner: -
--

CREATE INDEX idx_booking_link_token ON calendar.booking_link USING btree (organization_id, token) WHERE (status = 'active'::text);


--
-- Name: idx_calendar_event_reminder_pending; Type: INDEX; Schema: calendar; Owner: -
--

CREATE INDEX idx_calendar_event_reminder_pending ON calendar.event_reminder USING btree (organization_id, fire_at) WHERE (status = 'pending'::text);


--
-- Name: idx_check_in_event; Type: INDEX; Schema: calendar; Owner: -
--

CREATE INDEX idx_check_in_event ON calendar.check_in USING btree (organization_id, event_id);


--
-- Name: idx_delegation_delegate; Type: INDEX; Schema: calendar; Owner: -
--

CREATE INDEX idx_delegation_delegate ON calendar.delegation USING btree (organization_id, delegate_id);


--
-- Name: idx_event_org_organizer; Type: INDEX; Schema: calendar; Owner: -
--

CREATE INDEX idx_event_org_organizer ON calendar.event USING btree (organization_id, organizer_id, start_time DESC);


--
-- Name: idx_event_org_series; Type: INDEX; Schema: calendar; Owner: -
--

CREATE INDEX idx_event_org_series ON calendar.event USING btree (organization_id, series_id) WHERE (series_id IS NOT NULL);


--
-- Name: idx_event_org_time_range; Type: INDEX; Schema: calendar; Owner: -
--

CREATE INDEX idx_event_org_time_range ON calendar.event USING btree (organization_id, start_time, end_time) WHERE (cancelled_at IS NULL);


--
-- Name: idx_recurrence_exception_series; Type: INDEX; Schema: calendar; Owner: -
--

CREATE INDEX idx_recurrence_exception_series ON calendar.recurrence_exception USING btree (organization_id, series_id, original_start_time);


--
-- Name: idx_resource_acl_resource; Type: INDEX; Schema: calendar; Owner: -
--

CREATE INDEX idx_resource_acl_resource ON calendar.resource_acl USING btree (organization_id, resource_id);


--
-- Name: idx_resource_booking_resource_time; Type: INDEX; Schema: calendar; Owner: -
--

CREATE INDEX idx_resource_booking_resource_time ON calendar.resource_booking USING btree (organization_id, resource_id, start_time, end_time);


--
-- Name: idx_resource_org_type_active; Type: INDEX; Schema: calendar; Owner: -
--

CREATE INDEX idx_resource_org_type_active ON calendar.resource USING btree (organization_id, resource_type, is_active);


--
-- Name: idx_working_hours_employee; Type: INDEX; Schema: calendar; Owner: -
--

CREATE INDEX idx_working_hours_employee ON calendar.working_hours USING btree (organization_id, employee_id);


--
-- Name: idx_channel_org_type; Type: INDEX; Schema: chat; Owner: -
--

CREATE INDEX idx_channel_org_type ON chat.channel USING btree (organization_id, channel_type, is_archived);


--
-- Name: idx_channel_org_updated; Type: INDEX; Schema: chat; Owner: -
--

CREATE INDEX idx_channel_org_updated ON chat.channel USING btree (organization_id, updated_at DESC);


--
-- Name: idx_channel_search_trgm; Type: INDEX; Schema: chat; Owner: -
--

CREATE INDEX idx_channel_search_trgm ON chat.channel USING gin (display_name public.gin_trgm_ops);


--
-- Name: INDEX idx_channel_search_trgm; Type: COMMENT; Schema: chat; Owner: -
--

COMMENT ON INDEX chat.idx_channel_search_trgm IS 'Trigram index for fuzzy search on channel display_name. Supports multilingual queries.';


--
-- Name: idx_channel_visibility; Type: INDEX; Schema: chat; Owner: -
--

CREATE INDEX idx_channel_visibility ON chat.channel USING btree (organization_id, is_private, is_archived) WHERE (is_archived = false);


--
-- Name: idx_membership_admins; Type: INDEX; Schema: chat; Owner: -
--

CREATE INDEX idx_membership_admins ON chat.channel_membership USING btree (organization_id, channel_id) WHERE (is_admin = true);


--
-- Name: idx_membership_channel; Type: INDEX; Schema: chat; Owner: -
--

CREATE INDEX idx_membership_channel ON chat.channel_membership USING btree (organization_id, channel_id, notification_preference);


--
-- Name: idx_membership_employee; Type: INDEX; Schema: chat; Owner: -
--

CREATE INDEX idx_membership_employee ON chat.channel_membership USING btree (organization_id, employee_id, updated_at DESC);


--
-- Name: idx_membership_last_viewed; Type: INDEX; Schema: chat; Owner: -
--

CREATE INDEX idx_membership_last_viewed ON chat.channel_membership USING btree (organization_id, employee_id, last_viewed_at);


--
-- Name: idx_membership_last_viewed_message; Type: INDEX; Schema: chat; Owner: -
--

CREATE INDEX idx_membership_last_viewed_message ON chat.channel_membership USING btree (organization_id, channel_id, employee_id) WHERE (last_viewed_message_id IS NOT NULL);


--
-- Name: idx_message_author; Type: INDEX; Schema: chat; Owner: -
--

CREATE INDEX idx_message_author ON chat.message USING btree (organization_id, author_employee_id, id DESC);


--
-- Name: idx_message_channel_id; Type: INDEX; Schema: chat; Owner: -
--

CREATE INDEX idx_message_channel_id ON chat.message USING btree (organization_id, channel_id, id DESC) WHERE ((is_deleted = false) AND (parent_message_id IS NULL));


--
-- Name: idx_message_parent; Type: INDEX; Schema: chat; Owner: -
--

CREATE INDEX idx_message_parent ON chat.message USING btree (organization_id, parent_message_id) WHERE (parent_message_id IS NOT NULL);


--
-- Name: idx_message_pgroonga; Type: INDEX; Schema: chat; Owner: -
--

CREATE INDEX idx_message_pgroonga ON chat.message USING pgroonga (message_text);


--
-- Name: INDEX idx_message_pgroonga; Type: COMMENT; Schema: chat; Owner: -
--

COMMENT ON INDEX chat.idx_message_pgroonga IS 'PGroonga index for multilingual full-text search on message content. Automatically handles all languages including CJK (Chinese, Japanese, Korean) and Latin scripts without requiring language detection or configuration.';


--
-- Name: idx_reaction_employee; Type: INDEX; Schema: chat; Owner: -
--

CREATE INDEX idx_reaction_employee ON chat.reaction USING btree (organization_id, employee_id, updated_at DESC);


--
-- Name: idx_reaction_message; Type: INDEX; Schema: chat; Owner: -
--

CREATE INDEX idx_reaction_message ON chat.reaction USING btree (organization_id, message_id, emoji_code);


--
-- Name: idx_typing_channel; Type: INDEX; Schema: chat; Owner: -
--

CREATE INDEX idx_typing_channel ON chat.typing_indicator USING btree (organization_id, channel_id, updated_at DESC);


--
-- Name: idx_user_chat_config_categories; Type: INDEX; Schema: chat; Owner: -
--

CREATE INDEX idx_user_chat_config_categories ON chat.user_chat_config USING gin (channel_categories);


--
-- Name: idx_user_chat_config_employee; Type: INDEX; Schema: chat; Owner: -
--

CREATE INDEX idx_user_chat_config_employee ON chat.user_chat_config USING btree (organization_id, employee_id);


--
-- Name: idx_assignee_employee; Type: INDEX; Schema: collaboration; Owner: -
--

CREATE INDEX idx_assignee_employee ON collaboration.task_assignee USING btree (organization_id, employee_id);


--
-- Name: idx_assignee_task; Type: INDEX; Schema: collaboration; Owner: -
--

CREATE INDEX idx_assignee_task ON collaboration.task_assignee USING btree (organization_id, task_id);


--
-- Name: idx_evidence_req_definition; Type: INDEX; Schema: collaboration; Owner: -
--

CREATE INDEX idx_evidence_req_definition ON collaboration.evidence_requirement USING btree (organization_id, ritual_definition_id, "position");


--
-- Name: idx_evidence_sub_pending; Type: INDEX; Schema: collaboration; Owner: -
--

CREATE INDEX idx_evidence_sub_pending ON collaboration.evidence_submission USING btree (organization_id, approval_status) WHERE (approval_status = 'pending_review'::text);


--
-- Name: idx_evidence_sub_requirement; Type: INDEX; Schema: collaboration; Owner: -
--

CREATE INDEX idx_evidence_sub_requirement ON collaboration.evidence_submission USING btree (organization_id, evidence_requirement_id);


--
-- Name: idx_evidence_sub_submitter; Type: INDEX; Schema: collaboration; Owner: -
--

CREATE INDEX idx_evidence_sub_submitter ON collaboration.evidence_submission USING btree (organization_id, submitted_by_employee_id);


--
-- Name: idx_evidence_sub_task; Type: INDEX; Schema: collaboration; Owner: -
--

CREATE INDEX idx_evidence_sub_task ON collaboration.evidence_submission USING btree (organization_id, task_id);


--
-- Name: idx_execution_rule; Type: INDEX; Schema: collaboration; Owner: -
--

CREATE INDEX idx_execution_rule ON collaboration.workflow_rule_execution USING btree (organization_id, rule_id, executed_at DESC);


--
-- Name: idx_execution_status; Type: INDEX; Schema: collaboration; Owner: -
--

CREATE INDEX idx_execution_status ON collaboration.workflow_rule_execution USING btree (organization_id, status, executed_at DESC) WHERE (status = 'failed'::text);


--
-- Name: idx_execution_task; Type: INDEX; Schema: collaboration; Owner: -
--

CREATE INDEX idx_execution_task ON collaboration.workflow_rule_execution USING btree (organization_id, task_id, executed_at DESC);


--
-- Name: idx_field_def_project; Type: INDEX; Schema: collaboration; Owner: -
--

CREATE INDEX idx_field_def_project ON collaboration.custom_field_definition USING btree (organization_id, project_id, "position") WHERE (is_archived = false);


--
-- Name: idx_field_value_definition; Type: INDEX; Schema: collaboration; Owner: -
--

CREATE INDEX idx_field_value_definition ON collaboration.custom_field_value USING btree (organization_id, field_definition_id);


--
-- Name: idx_field_value_json; Type: INDEX; Schema: collaboration; Owner: -
--

CREATE INDEX idx_field_value_json ON collaboration.custom_field_value USING gin (value);


--
-- Name: idx_field_value_task; Type: INDEX; Schema: collaboration; Owner: -
--

CREATE INDEX idx_field_value_task ON collaboration.custom_field_value USING btree (organization_id, task_id);


--
-- Name: idx_level_project; Type: INDEX; Schema: collaboration; Owner: -
--

CREATE INDEX idx_level_project ON collaboration.task_level USING btree (organization_id, project_id, depth);


--
-- Name: idx_membership_employee; Type: INDEX; Schema: collaboration; Owner: -
--

CREATE INDEX idx_membership_employee ON collaboration.project_membership USING btree (organization_id, employee_id);


--
-- Name: idx_membership_project; Type: INDEX; Schema: collaboration; Owner: -
--

CREATE INDEX idx_membership_project ON collaboration.project_membership USING btree (organization_id, project_id, role);


--
-- Name: idx_project_collab_mode; Type: INDEX; Schema: collaboration; Owner: -
--

CREATE INDEX idx_project_collab_mode ON collaboration.project USING btree (organization_id, collaboration_mode) WHERE (is_archived = false);


--
-- Name: idx_project_name_trgm; Type: INDEX; Schema: collaboration; Owner: -
--

CREATE INDEX idx_project_name_trgm ON collaboration.project USING gin (name public.gin_trgm_ops);


--
-- Name: idx_project_owner; Type: INDEX; Schema: collaboration; Owner: -
--

CREATE INDEX idx_project_owner ON collaboration.project USING btree (organization_id, owner_employee_id);


--
-- Name: idx_project_visibility; Type: INDEX; Schema: collaboration; Owner: -
--

CREATE INDEX idx_project_visibility ON collaboration.project USING btree (organization_id, visibility, is_archived) WHERE (is_archived = false);


--
-- Name: idx_rda_definition; Type: INDEX; Schema: collaboration; Owner: -
--

CREATE INDEX idx_rda_definition ON collaboration.ritual_definition_assignee USING btree (organization_id, ritual_definition_id);


--
-- Name: idx_rddp_definition; Type: INDEX; Schema: collaboration; Owner: -
--

CREATE INDEX idx_rddp_definition ON collaboration.ritual_definition_department_pool USING btree (organization_id, ritual_definition_id);


--
-- Name: idx_ritual_def_generation; Type: INDEX; Schema: collaboration; Owner: -
--

CREATE INDEX idx_ritual_def_generation ON collaboration.ritual_definition USING btree (organization_id, is_archived, last_generated_date) WHERE (is_archived = false);


--
-- Name: idx_ritual_def_project; Type: INDEX; Schema: collaboration; Owner: -
--

CREATE INDEX idx_ritual_def_project ON collaboration.ritual_definition USING btree (organization_id, project_id) WHERE (is_archived = false);


--
-- Name: idx_rule_project; Type: INDEX; Schema: collaboration; Owner: -
--

CREATE INDEX idx_rule_project ON collaboration.workflow_rule USING btree (organization_id, project_id, "position") WHERE (is_enabled = true);


--
-- Name: idx_rule_trigger_state; Type: INDEX; Schema: collaboration; Owner: -
--

CREATE INDEX idx_rule_trigger_state ON collaboration.workflow_rule USING btree (organization_id, trigger_state_id) WHERE ((trigger_state_id IS NOT NULL) AND (is_enabled = true));


--
-- Name: idx_state_initial; Type: INDEX; Schema: collaboration; Owner: -
--

CREATE INDEX idx_state_initial ON collaboration.project_state USING btree (organization_id, project_id) WHERE (is_initial = true);


--
-- Name: idx_state_project; Type: INDEX; Schema: collaboration; Owner: -
--

CREATE INDEX idx_state_project ON collaboration.project_state USING btree (organization_id, project_id, "position");


--
-- Name: idx_state_project_type; Type: INDEX; Schema: collaboration; Owner: -
--

CREATE INDEX idx_state_project_type ON collaboration.project_state USING btree (organization_id, project_id, state_type, "position");


--
-- Name: idx_task_channel; Type: INDEX; Schema: collaboration; Owner: -
--

CREATE INDEX idx_task_channel ON collaboration.task USING btree (organization_id, channel_id) WHERE (channel_id IS NOT NULL);


--
-- Name: idx_task_dates; Type: INDEX; Schema: collaboration; Owner: -
--

CREATE INDEX idx_task_dates ON collaboration.task USING btree (organization_id, project_id, start_date, due_date) WHERE (is_deleted = false);


--
-- Name: idx_task_parent; Type: INDEX; Schema: collaboration; Owner: -
--

CREATE INDEX idx_task_parent ON collaboration.task USING btree (organization_id, parent_task_id) WHERE (parent_task_id IS NOT NULL);


--
-- Name: idx_task_path; Type: INDEX; Schema: collaboration; Owner: -
--

CREATE INDEX idx_task_path ON collaboration.task USING gin (path);


--
-- Name: idx_task_project_state; Type: INDEX; Schema: collaboration; Owner: -
--

CREATE INDEX idx_task_project_state ON collaboration.task USING btree (organization_id, project_id, state_id, updated_at DESC) WHERE (is_deleted = false);


--
-- Name: idx_task_reporter; Type: INDEX; Schema: collaboration; Owner: -
--

CREATE INDEX idx_task_reporter ON collaboration.task USING btree (organization_id, reporter_employee_id);


--
-- Name: idx_task_ritual_definition; Type: INDEX; Schema: collaboration; Owner: -
--

CREATE INDEX idx_task_ritual_definition ON collaboration.task USING btree (organization_id, ritual_definition_id, scheduled_date DESC) WHERE ((task_kind = 'ritual_instance'::text) AND (is_deleted = false));


--
-- Name: idx_task_ritual_instance_unique; Type: INDEX; Schema: collaboration; Owner: -
--

CREATE UNIQUE INDEX idx_task_ritual_instance_unique ON collaboration.task USING btree (organization_id, ritual_definition_id, scheduled_date) WHERE ((task_kind = 'ritual_instance'::text) AND (ritual_definition_id IS NOT NULL) AND (is_deleted = false));


--
-- Name: idx_task_ritual_today; Type: INDEX; Schema: collaboration; Owner: -
--

CREATE INDEX idx_task_ritual_today ON collaboration.task USING btree (organization_id, task_kind, completion_deadline) WHERE ((task_kind = 'ritual_instance'::text) AND (is_deleted = false));


--
-- Name: idx_task_source_message; Type: INDEX; Schema: collaboration; Owner: -
--

CREATE INDEX idx_task_source_message ON collaboration.task USING btree (organization_id, source_message_id) WHERE (source_message_id IS NOT NULL);


--
-- Name: idx_task_title_pgroonga; Type: INDEX; Schema: collaboration; Owner: -
--

CREATE INDEX idx_task_title_pgroonga ON collaboration.task USING pgroonga (title);


--
-- Name: idx_task_title_trgm; Type: INDEX; Schema: collaboration; Owner: -
--

CREATE INDEX idx_task_title_trgm ON collaboration.task USING gin (title public.gin_trgm_ops);


--
-- Name: idx_view_employee; Type: INDEX; Schema: collaboration; Owner: -
--

CREATE INDEX idx_view_employee ON collaboration.saved_view USING btree (organization_id, employee_id) WHERE (employee_id IS NOT NULL);


--
-- Name: idx_view_project; Type: INDEX; Schema: collaboration; Owner: -
--

CREATE INDEX idx_view_project ON collaboration.saved_view USING btree (organization_id, project_id, "position");


--
-- Name: idx_compliance_account_deletion_active; Type: INDEX; Schema: compliance; Owner: -
--

CREATE INDEX idx_compliance_account_deletion_active ON compliance.account_deletion USING btree (organization_id, state) WHERE (state = ANY (ARRAY['pending'::text, 'anonymising'::text, 'purging'::text]));


--
-- Name: idx_compliance_account_deletion_user; Type: INDEX; Schema: compliance; Owner: -
--

CREATE INDEX idx_compliance_account_deletion_user ON compliance.account_deletion USING btree (organization_id, user_id);


--
-- Name: idx_compliance_block_blocked; Type: INDEX; Schema: compliance; Owner: -
--

CREATE INDEX idx_compliance_block_blocked ON compliance.block USING btree (organization_id, blocked_employee_id);


--
-- Name: idx_compliance_content_report_queue; Type: INDEX; Schema: compliance; Owner: -
--

CREATE INDEX idx_compliance_content_report_queue ON compliance.content_report USING btree (organization_id, status, id DESC);


--
-- Name: idx_compliance_content_report_reported; Type: INDEX; Schema: compliance; Owner: -
--

CREATE INDEX idx_compliance_content_report_reported ON compliance.content_report USING btree (organization_id, reported_employee_id);


--
-- Name: idx_compliance_removal_request_queue; Type: INDEX; Schema: compliance; Owner: -
--

CREATE INDEX idx_compliance_removal_request_queue ON compliance.removal_request USING btree (organization_id, status, id DESC);


--
-- Name: uq_compliance_removal_request_outstanding; Type: INDEX; Schema: compliance; Owner: -
--

CREATE UNIQUE INDEX uq_compliance_removal_request_outstanding ON compliance.removal_request USING btree (organization_id, employee_id) WHERE (status = 'outstanding'::text);


--
-- Name: idx_access_department; Type: INDEX; Schema: docs; Owner: -
--

CREATE INDEX idx_access_department ON docs.document_access USING btree (organization_id, grantee_id, grantee_type) WHERE (grantee_type = 'department'::text);


--
-- Name: idx_access_document; Type: INDEX; Schema: docs; Owner: -
--

CREATE INDEX idx_access_document ON docs.document_access USING btree (organization_id, document_id, access_level);


--
-- Name: idx_access_employee; Type: INDEX; Schema: docs; Owner: -
--

CREATE INDEX idx_access_employee ON docs.document_access USING btree (organization_id, grantee_id, grantee_type) WHERE (grantee_type = 'employee'::text);


--
-- Name: idx_comment_author; Type: INDEX; Schema: docs; Owner: -
--

CREATE INDEX idx_comment_author ON docs.comment USING btree (organization_id, author_employee_id, updated_at DESC);


--
-- Name: idx_comment_block; Type: INDEX; Schema: docs; Owner: -
--

CREATE INDEX idx_comment_block ON docs.comment USING btree (organization_id, document_id, block_id);


--
-- Name: idx_comment_document; Type: INDEX; Schema: docs; Owner: -
--

CREATE INDEX idx_comment_document ON docs.comment USING btree (organization_id, document_id, is_resolved, updated_at DESC);


--
-- Name: idx_document_owner; Type: INDEX; Schema: docs; Owner: -
--

CREATE INDEX idx_document_owner ON docs.document USING btree (organization_id, owner_employee_id);


--
-- Name: idx_document_parent; Type: INDEX; Schema: docs; Owner: -
--

CREATE INDEX idx_document_parent ON docs.document USING btree (organization_id, parent_document_id) WHERE (parent_document_id IS NOT NULL);


--
-- Name: idx_document_path; Type: INDEX; Schema: docs; Owner: -
--

CREATE INDEX idx_document_path ON docs.document USING gin (path);


--
-- Name: idx_document_pgroonga; Type: INDEX; Schema: docs; Owner: -
--

CREATE INDEX idx_document_pgroonga ON docs.document USING pgroonga (content_text);


--
-- Name: idx_document_status; Type: INDEX; Schema: docs; Owner: -
--

CREATE INDEX idx_document_status ON docs.document USING btree (organization_id, status, updated_at DESC);


--
-- Name: idx_document_title_trgm; Type: INDEX; Schema: docs; Owner: -
--

CREATE INDEX idx_document_title_trgm ON docs.document USING gin (title public.gin_trgm_ops);


--
-- Name: idx_editor_document; Type: INDEX; Schema: docs; Owner: -
--

CREATE INDEX idx_editor_document ON docs.document_editor USING btree (organization_id, document_id);


--
-- Name: idx_editor_heartbeat; Type: INDEX; Schema: docs; Owner: -
--

CREATE INDEX idx_editor_heartbeat ON docs.document_editor USING btree (organization_id, last_heartbeat);


--
-- Name: idx_editor_instance; Type: INDEX; Schema: docs; Owner: -
--

CREATE INDEX idx_editor_instance ON docs.document_editor USING btree (organization_id, instance_id);


--
-- Name: idx_embed_source; Type: INDEX; Schema: docs; Owner: -
--

CREATE INDEX idx_embed_source ON docs.section_embed USING btree (organization_id, source_document_id);


--
-- Name: idx_embed_target; Type: INDEX; Schema: docs; Owner: -
--

CREATE INDEX idx_embed_target ON docs.section_embed USING btree (organization_id, target_document_id);


--
-- Name: idx_embed_target_lines; Type: INDEX; Schema: docs; Owner: -
--

CREATE INDEX idx_embed_target_lines ON docs.section_embed USING btree (organization_id, target_document_id, target_line_start, target_line_end);


--
-- Name: idx_reaction_document; Type: INDEX; Schema: docs; Owner: -
--

CREATE INDEX idx_reaction_document ON docs.document_reaction USING btree (organization_id, document_id, reaction_type);


--
-- Name: idx_reaction_employee; Type: INDEX; Schema: docs; Owner: -
--

CREATE INDEX idx_reaction_employee ON docs.document_reaction USING btree (organization_id, employee_id, updated_at DESC);


--
-- Name: idx_reply_comment; Type: INDEX; Schema: docs; Owner: -
--

CREATE INDEX idx_reply_comment ON docs.comment_reply USING btree (organization_id, comment_id, updated_at);


--
-- Name: idx_slug_history_document; Type: INDEX; Schema: docs; Owner: -
--

CREATE INDEX idx_slug_history_document ON docs.document_slug_history USING btree (organization_id, document_id, changed_at DESC);


--
-- Name: idx_version_author; Type: INDEX; Schema: docs; Owner: -
--

CREATE INDEX idx_version_author ON docs.document_version USING btree (organization_id, author_employee_id, created_at DESC);


--
-- Name: idx_version_document; Type: INDEX; Schema: docs; Owner: -
--

CREATE INDEX idx_version_document ON docs.document_version USING btree (organization_id, document_id, version_number DESC);


--
-- Name: idx_deletion_log_deleter; Type: INDEX; Schema: files; Owner: -
--

CREATE INDEX idx_deletion_log_deleter ON files.file_deletion_log USING btree (organization_id, deleted_by_employee_id, deleted_at DESC);


--
-- Name: idx_deletion_log_file_id; Type: INDEX; Schema: files; Owner: -
--

CREATE INDEX idx_deletion_log_file_id ON files.file_deletion_log USING btree (organization_id, file_id, deleted_at DESC);


--
-- Name: idx_file_access_context; Type: INDEX; Schema: files; Owner: -
--

CREATE INDEX idx_file_access_context ON files.file_access_rule USING btree (organization_id, context_type, context_id);


--
-- Name: idx_file_access_file; Type: INDEX; Schema: files; Owner: -
--

CREATE INDEX idx_file_access_file ON files.file_access_rule USING btree (organization_id, file_id);


--
-- Name: idx_file_content_file; Type: INDEX; Schema: files; Owner: -
--

CREATE INDEX idx_file_content_file ON files.file_content_index USING btree (organization_id, file_id);


--
-- Name: idx_file_content_pgroonga; Type: INDEX; Schema: files; Owner: -
--

CREATE INDEX idx_file_content_pgroonga ON files.file_content_index USING pgroonga (extracted_text);


--
-- Name: INDEX idx_file_content_pgroonga; Type: COMMENT; Schema: files; Owner: -
--

COMMENT ON INDEX files.idx_file_content_pgroonga IS 'PGroonga index for multilingual full-text search on extracted file content. Automatically handles all languages including CJK (Chinese, Japanese, Korean) and Latin scripts without requiring language detection or configuration. Used for file search across organization.';


--
-- Name: idx_file_content_status; Type: INDEX; Schema: files; Owner: -
--

CREATE INDEX idx_file_content_status ON files.file_content_index USING btree (organization_id, indexing_status, updated_at DESC) WHERE (indexing_status = ANY (ARRAY['pending'::text, 'in_progress'::text]));


--
-- Name: idx_file_metadata_active; Type: INDEX; Schema: files; Owner: -
--

CREATE INDEX idx_file_metadata_active ON files.file_metadata USING btree (organization_id, updated_at DESC) WHERE (is_deleted = false);


--
-- Name: idx_file_metadata_context; Type: INDEX; Schema: files; Owner: -
--

CREATE INDEX idx_file_metadata_context ON files.file_metadata USING btree (organization_id, upload_context, updated_at DESC);


--
-- Name: idx_file_metadata_storage_key; Type: INDEX; Schema: files; Owner: -
--

CREATE INDEX idx_file_metadata_storage_key ON files.file_metadata USING btree (organization_id, storage_key);


--
-- Name: idx_file_metadata_uploader; Type: INDEX; Schema: files; Owner: -
--

CREATE INDEX idx_file_metadata_uploader ON files.file_metadata USING btree (organization_id, uploaded_by_employee_id);


--
-- Name: idx_file_metadata_validation; Type: INDEX; Schema: files; Owner: -
--

CREATE INDEX idx_file_metadata_validation ON files.file_metadata USING btree (organization_id, validation_status, updated_at DESC) WHERE (validation_status = ANY (ARRAY['warning'::text, 'failed'::text, 'dangerous'::text]));


--
-- Name: idx_pdf_conversion_original; Type: INDEX; Schema: files; Owner: -
--

CREATE INDEX idx_pdf_conversion_original ON files.file_pdf_conversion USING btree (organization_id, original_file_id);


--
-- Name: idx_pdf_conversion_status; Type: INDEX; Schema: files; Owner: -
--

CREATE INDEX idx_pdf_conversion_status ON files.file_pdf_conversion USING btree (organization_id, conversion_status, updated_at DESC) WHERE (conversion_status = ANY (ARRAY['pending'::text, 'in_progress'::text]));


--
-- Name: idx_pdf_conversion_storage_key; Type: INDEX; Schema: files; Owner: -
--

CREATE INDEX idx_pdf_conversion_storage_key ON files.file_pdf_conversion USING btree (organization_id, pdf_storage_key);


--
-- Name: runs_runnable_idx; Type: INDEX; Schema: flows; Owner: -
--

CREATE INDEX runs_runnable_idx ON flows.runs USING btree (workflow_name_shard, status, next_wake_at, created_at);


--
-- Name: waits_event_idx; Type: INDEX; Schema: flows; Owner: -
--

CREATE INDEX waits_event_idx ON flows.waits USING btree (workflow_name_shard, event_name, satisfied_at);


--
-- Name: idx_credential_expires; Type: INDEX; Schema: iam; Owner: -
--

CREATE INDEX idx_credential_expires ON iam.credential USING btree (organization_id, expires_at) WHERE (state = 'temporary'::text);


--
-- Name: idx_credential_identity; Type: INDEX; Schema: iam; Owner: -
--

CREATE INDEX idx_credential_identity ON iam.credential USING btree (organization_id, identity_id);


--
-- Name: idx_credential_identity_type_active; Type: INDEX; Schema: iam; Owner: -
--

CREATE UNIQUE INDEX idx_credential_identity_type_active ON iam.credential USING btree (organization_id, identity_id, credential_type) WHERE (state = ANY (ARRAY['active'::text, 'temporary'::text]));


--
-- Name: idx_employee_role_employee; Type: INDEX; Schema: iam; Owner: -
--

CREATE INDEX idx_employee_role_employee ON iam.employee_role USING btree (organization_id, employee_id);


--
-- Name: idx_employee_role_role; Type: INDEX; Schema: iam; Owner: -
--

CREATE INDEX idx_employee_role_role ON iam.employee_role USING btree (organization_id, role_id);


--
-- Name: idx_iam_identity_org_email; Type: INDEX; Schema: iam; Owner: -
--

CREATE UNIQUE INDEX idx_iam_identity_org_email ON iam.identity USING btree (organization_id, email) WHERE (email IS NOT NULL);


--
-- Name: idx_identity_email_trgm; Type: INDEX; Schema: iam; Owner: -
--

CREATE INDEX idx_identity_email_trgm ON iam.identity USING gin (email public.gin_trgm_ops);


--
-- Name: INDEX idx_identity_email_trgm; Type: COMMENT; Schema: iam; Owner: -
--

COMMENT ON INDEX iam.idx_identity_email_trgm IS 'Trigram index for fuzzy search on email addresses. Supports typo-tolerant email search for employee lookup.';


--
-- Name: idx_identity_org_login_identifier; Type: INDEX; Schema: iam; Owner: -
--

CREATE UNIQUE INDEX idx_identity_org_login_identifier ON iam.identity USING btree (organization_id, login_identifier) WHERE (login_identifier IS NOT NULL);


--
-- Name: idx_invitation_email; Type: INDEX; Schema: iam; Owner: -
--

CREATE INDEX idx_invitation_email ON iam.invitation USING btree (email, status);


--
-- Name: idx_invitation_expiry; Type: INDEX; Schema: iam; Owner: -
--

CREATE INDEX idx_invitation_expiry ON iam.invitation USING btree (expires_at) WHERE (status = 'pending'::text);


--
-- Name: idx_invitation_org; Type: INDEX; Schema: iam; Owner: -
--

CREATE INDEX idx_invitation_org ON iam.invitation USING btree (organization_id, status);


--
-- Name: idx_invitation_token; Type: INDEX; Schema: iam; Owner: -
--

CREATE INDEX idx_invitation_token ON iam.invitation USING btree (token) WHERE (status = 'pending'::text);


--
-- Name: idx_password_user; Type: INDEX; Schema: iam; Owner: -
--

CREATE INDEX idx_password_user ON iam.password_credential USING btree (user_id);


--
-- Name: idx_reset_expiry; Type: INDEX; Schema: iam; Owner: -
--

CREATE INDEX idx_reset_expiry ON iam.password_reset_token USING btree (expires_at) WHERE (used_at IS NULL);


--
-- Name: idx_reset_token; Type: INDEX; Schema: iam; Owner: -
--

CREATE INDEX idx_reset_token ON iam.password_reset_token USING btree (token) WHERE (used_at IS NULL);


--
-- Name: idx_reset_user; Type: INDEX; Schema: iam; Owner: -
--

CREATE INDEX idx_reset_user ON iam.password_reset_token USING btree (user_id);


--
-- Name: idx_role_org_system; Type: INDEX; Schema: iam; Owner: -
--

CREATE INDEX idx_role_org_system ON iam.role USING btree (organization_id, is_system);


--
-- Name: idx_session_expiry; Type: INDEX; Schema: iam; Owner: -
--

CREATE INDEX idx_session_expiry ON iam.session USING btree (expires_at) WHERE (invalidated_at IS NULL);


--
-- Name: idx_session_token; Type: INDEX; Schema: iam; Owner: -
--

CREATE INDEX idx_session_token ON iam.session USING btree (token_jti) WHERE (invalidated_at IS NULL);


--
-- Name: idx_session_user; Type: INDEX; Schema: iam; Owner: -
--

CREATE INDEX idx_session_user ON iam.session USING btree (user_id) WHERE (invalidated_at IS NULL);


--
-- Name: idx_sso_provider_id; Type: INDEX; Schema: iam; Owner: -
--

CREATE INDEX idx_sso_provider_id ON iam.sso_identity USING btree (provider, provider_user_id);


--
-- Name: idx_sso_user; Type: INDEX; Schema: iam; Owner: -
--

CREATE INDEX idx_sso_user ON iam.sso_identity USING btree (user_id);


--
-- Name: idx_user_email; Type: INDEX; Schema: iam; Owner: -
--

CREATE UNIQUE INDEX idx_user_email ON iam."user" USING btree (email) WHERE (email IS NOT NULL);


--
-- Name: idx_user_preference_employee; Type: INDEX; Schema: iam; Owner: -
--

CREATE INDEX idx_user_preference_employee ON iam.user_preference USING btree (organization_id, employee_id);


--
-- Name: idx_user_preference_updated; Type: INDEX; Schema: iam; Owner: -
--

CREATE INDEX idx_user_preference_updated ON iam.user_preference USING btree (organization_id, updated_at DESC);


--
-- Name: idx_user_status; Type: INDEX; Schema: iam; Owner: -
--

CREATE INDEX idx_user_status ON iam."user" USING btree (status) WHERE (status = 'active'::text);


--
-- Name: idx_active_connection_channel_live; Type: INDEX; Schema: notification; Owner: -
--

CREATE INDEX idx_active_connection_channel_live ON notification.active_connection USING btree (organization_id, active_channel_id, last_pong_at DESC) WHERE (active_channel_id IS NOT NULL);


--
-- Name: idx_active_connection_departments; Type: INDEX; Schema: notification; Owner: -
--

CREATE INDEX idx_active_connection_departments ON notification.active_connection USING gin (department_ids);


--
-- Name: idx_active_connection_employee_live; Type: INDEX; Schema: notification; Owner: -
--

CREATE INDEX idx_active_connection_employee_live ON notification.active_connection USING btree (organization_id, employee_id, last_pong_at DESC);


--
-- Name: idx_active_connection_expiry; Type: INDEX; Schema: notification; Owner: -
--

CREATE INDEX idx_active_connection_expiry ON notification.active_connection USING btree (organization_id, last_pong_at);


--
-- Name: idx_active_connection_instance; Type: INDEX; Schema: notification; Owner: -
--

CREATE INDEX idx_active_connection_instance ON notification.active_connection USING btree (organization_id, instance_id);


--
-- Name: idx_active_context_org_lookup; Type: INDEX; Schema: notification; Owner: -
--

CREATE INDEX idx_active_context_org_lookup ON notification.active_context USING btree (organization_id, context_type, context_id, last_seen_at DESC);


--
-- Name: idx_active_listener_status; Type: INDEX; Schema: notification; Owner: -
--

CREATE INDEX idx_active_listener_status ON notification.active_listener USING btree (listener_status, last_heartbeat DESC);


--
-- Name: idx_batch_key; Type: INDEX; Schema: notification; Owner: -
--

CREATE INDEX idx_batch_key ON notification.notification_batch USING btree (organization_id, batch_key) WHERE (processing_status = 'pending'::text);


--
-- Name: idx_batch_org_status; Type: INDEX; Schema: notification; Owner: -
--

CREATE INDEX idx_batch_org_status ON notification.notification_batch USING btree (organization_id, processing_status, updated_at);


--
-- Name: idx_delivery_attempt_org_recipient_attempted; Type: INDEX; Schema: notification; Owner: -
--

CREATE INDEX idx_delivery_attempt_org_recipient_attempted ON notification.delivery_attempt USING btree (organization_id, notification_recipient_id, attempted_at DESC);


--
-- Name: idx_delivery_log_recipient; Type: INDEX; Schema: notification; Owner: -
--

CREATE INDEX idx_delivery_log_recipient ON notification.notification_delivery_log USING btree (organization_id, notification_recipient_id, attempted_at DESC);


--
-- Name: idx_delivery_log_result; Type: INDEX; Schema: notification; Owner: -
--

CREATE INDEX idx_delivery_log_result ON notification.notification_delivery_log USING btree (organization_id, delivery_result, attempted_at DESC) WHERE (delivery_result = 'failed'::text);


--
-- Name: idx_ephemeral_signal_channel; Type: INDEX; Schema: notification; Owner: -
--

CREATE INDEX idx_ephemeral_signal_channel ON notification.ephemeral_signal USING btree (organization_id, channel_id, created_at DESC);


--
-- Name: idx_live_receipt_org_recipient_connection; Type: INDEX; Schema: notification; Owner: -
--

CREATE UNIQUE INDEX idx_live_receipt_org_recipient_connection ON notification.live_receipt USING btree (organization_id, notification_recipient_id, connection_id);


--
-- Name: idx_live_receipt_org_recipient_received; Type: INDEX; Schema: notification; Owner: -
--

CREATE INDEX idx_live_receipt_org_recipient_received ON notification.live_receipt USING btree (organization_id, notification_recipient_id, received_at DESC);


--
-- Name: idx_notification_action_data; Type: INDEX; Schema: notification; Owner: -
--

CREATE INDEX idx_notification_action_data ON notification.notification USING gin (action_data);


--
-- Name: idx_notification_org_updated; Type: INDEX; Schema: notification; Owner: -
--

CREATE INDEX idx_notification_org_updated ON notification.notification USING btree (organization_id, updated_at DESC);


--
-- Name: idx_notification_source; Type: INDEX; Schema: notification; Owner: -
--

CREATE INDEX idx_notification_source ON notification.notification USING btree (organization_id, source_domain, updated_at DESC);


--
-- Name: idx_presence_visibility_org_mode; Type: INDEX; Schema: notification; Owner: -
--

CREATE INDEX idx_presence_visibility_org_mode ON notification.presence_visibility USING btree (organization_id, visibility_mode);


--
-- Name: idx_push_token_employee; Type: INDEX; Schema: notification; Owner: -
--

CREATE INDEX idx_push_token_employee ON notification.push_token USING btree (organization_id, employee_id) WHERE (is_valid = true);


--
-- Name: idx_push_token_last_used; Type: INDEX; Schema: notification; Owner: -
--

CREATE INDEX idx_push_token_last_used ON notification.push_token USING btree (organization_id, last_used_at) WHERE (is_valid = true);


--
-- Name: idx_recipient_delivery_status; Type: INDEX; Schema: notification; Owner: -
--

CREATE INDEX idx_recipient_delivery_status ON notification.notification_recipient USING btree (organization_id, delivery_status, updated_at) WHERE (delivery_status = 'pending'::text);


--
-- Name: idx_recipient_employee_org; Type: INDEX; Schema: notification; Owner: -
--

CREATE INDEX idx_recipient_employee_org ON notification.notification_recipient USING btree (organization_id, employee_id, read_status);


--
-- Name: idx_recipient_fallback_due; Type: INDEX; Schema: notification; Owner: -
--

CREATE INDEX idx_recipient_fallback_due ON notification.notification_recipient USING btree (organization_id, fallback_status, fallback_due_at) WHERE ((fallback_status = 'queued'::text) AND (fallback_due_at IS NOT NULL));


--
-- Name: idx_recipient_notification; Type: INDEX; Schema: notification; Owner: -
--

CREATE INDEX idx_recipient_notification ON notification.notification_recipient USING btree (organization_id, notification_id);


--
-- Name: idx_recipient_read_status; Type: INDEX; Schema: notification; Owner: -
--

CREATE INDEX idx_recipient_read_status ON notification.notification_recipient USING btree (organization_id, employee_id, updated_at DESC) WHERE (read_status = false);


--
-- Name: idx_resource_subscription_employee; Type: INDEX; Schema: notification; Owner: -
--

CREATE INDEX idx_resource_subscription_employee ON notification.resource_subscription USING btree (organization_id, employee_id, updated_at DESC);


--
-- Name: idx_resource_subscription_reason_subscription; Type: INDEX; Schema: notification; Owner: -
--

CREATE INDEX idx_resource_subscription_reason_subscription ON notification.resource_subscription_reason USING btree (organization_id, subscription_id, created_at);


--
-- Name: idx_resource_subscription_reason_unique; Type: INDEX; Schema: notification; Owner: -
--

CREATE UNIQUE INDEX idx_resource_subscription_reason_unique ON notification.resource_subscription_reason USING btree (organization_id, subscription_id, reason_type, COALESCE(reason_ref_type, ''::text), COALESCE(reason_ref_id, '00000000-0000-0000-0000-000000000000'::uuid));


--
-- Name: idx_resource_subscription_resource; Type: INDEX; Schema: notification; Owner: -
--

CREATE INDEX idx_resource_subscription_resource ON notification.resource_subscription USING btree (organization_id, resource_domain, resource_id, subscription_state);


--
-- Name: idx_resource_surface_parent; Type: INDEX; Schema: notification; Owner: -
--

CREATE INDEX idx_resource_surface_parent ON notification.resource_surface USING btree (organization_id, parent_domain, parent_resource_id, inherits_subscription);


--
-- Name: idx_department_member_dept; Type: INDEX; Schema: organization; Owner: -
--

CREATE INDEX idx_department_member_dept ON organization.department_member USING btree (organization_id, department_id, role);


--
-- Name: idx_department_member_employee; Type: INDEX; Schema: organization; Owner: -
--

CREATE INDEX idx_department_member_employee ON organization.department_member USING btree (organization_id, employee_id);


--
-- Name: idx_department_org_parent; Type: INDEX; Schema: organization; Owner: -
--

CREATE INDEX idx_department_org_parent ON organization.department USING btree (organization_id, parent_department_id);


--
-- Name: idx_department_parent; Type: INDEX; Schema: organization; Owner: -
--

CREATE INDEX idx_department_parent ON organization.department USING btree (organization_id, parent_department_id) WHERE (parent_department_id IS NOT NULL);


--
-- Name: idx_department_search_trgm; Type: INDEX; Schema: organization; Owner: -
--

CREATE INDEX idx_department_search_trgm ON organization.department USING gin ((((name || ' '::text) || COALESCE(description, ''::text))) public.gin_trgm_ops);


--
-- Name: INDEX idx_department_search_trgm; Type: COMMENT; Schema: organization; Owner: -
--

COMMENT ON INDEX organization.idx_department_search_trgm IS 'Trigram index for fuzzy search on department name and description. Supports multilingual queries.';


--
-- Name: idx_employee_family_name_trgm; Type: INDEX; Schema: organization; Owner: -
--

CREATE INDEX idx_employee_family_name_trgm ON organization.employee USING gin (family_name public.gin_trgm_ops);


--
-- Name: INDEX idx_employee_family_name_trgm; Type: COMMENT; Schema: organization; Owner: -
--

COMMENT ON INDEX organization.idx_employee_family_name_trgm IS 'Trigram index for fuzzy search on employee family names. Smaller index size than concatenated fields.';


--
-- Name: idx_employee_given_name_trgm; Type: INDEX; Schema: organization; Owner: -
--

CREATE INDEX idx_employee_given_name_trgm ON organization.employee USING gin (given_name public.gin_trgm_ops);


--
-- Name: INDEX idx_employee_given_name_trgm; Type: COMMENT; Schema: organization; Owner: -
--

COMMENT ON INDEX organization.idx_employee_given_name_trgm IS 'Trigram index for fuzzy search on employee given names. Smaller index size than concatenated fields.';


--
-- Name: idx_one_department_per_employee; Type: INDEX; Schema: organization; Owner: -
--

CREATE UNIQUE INDEX idx_one_department_per_employee ON organization.department_member USING btree (organization_id, employee_id);


--
-- Name: idx_call_session_ring_deadline; Type: INDEX; Schema: voice; Owner: -
--

CREATE INDEX idx_call_session_ring_deadline ON voice.call_session USING btree (organization_id, ring_deadline_at) WHERE ((state = 'ringing'::text) AND (ring_deadline_at IS NOT NULL));


--
-- Name: idx_voice_artifact_status; Type: INDEX; Schema: voice; Owner: -
--

CREATE INDEX idx_voice_artifact_status ON voice.call_artifact USING btree (organization_id, status, updated_at);


--
-- Name: idx_voice_call_active_per_channel; Type: INDEX; Schema: voice; Owner: -
--

CREATE UNIQUE INDEX idx_voice_call_active_per_channel ON voice.call_session USING btree (organization_id, channel_id) WHERE (state = ANY (ARRAY['ringing'::text, 'active'::text, 'ending'::text]));


--
-- Name: idx_voice_call_channel_history; Type: INDEX; Schema: voice; Owner: -
--

CREATE INDEX idx_voice_call_channel_history ON voice.call_session USING btree (organization_id, channel_id, started_at DESC);


--
-- Name: idx_voice_call_livekit_room; Type: INDEX; Schema: voice; Owner: -
--

CREATE UNIQUE INDEX idx_voice_call_livekit_room ON voice.call_session USING btree (organization_id, livekit_room_name);


--
-- Name: idx_voice_call_state_updated; Type: INDEX; Schema: voice; Owner: -
--

CREATE INDEX idx_voice_call_state_updated ON voice.call_session USING btree (organization_id, state, updated_at DESC);


--
-- Name: idx_voice_invitation_invitee; Type: INDEX; Schema: voice; Owner: -
--

CREATE INDEX idx_voice_invitation_invitee ON voice.call_invitation USING btree (organization_id, invitee_employee_id, status, created_at DESC);


--
-- Name: idx_voice_invitation_pending; Type: INDEX; Schema: voice; Owner: -
--

CREATE UNIQUE INDEX idx_voice_invitation_pending ON voice.call_invitation USING btree (organization_id, call_session_id, invitee_employee_id) WHERE (status = 'pending'::text);


--
-- Name: idx_voice_message_channel; Type: INDEX; Schema: voice; Owner: -
--

CREATE INDEX idx_voice_message_channel ON voice.voice_message USING btree (organization_id, channel_id, created_at DESC);


--
-- Name: idx_voice_message_posted_message; Type: INDEX; Schema: voice; Owner: -
--

CREATE UNIQUE INDEX idx_voice_message_posted_message ON voice.voice_message USING btree (organization_id, message_id) WHERE (message_id IS NOT NULL);


--
-- Name: idx_voice_participant_call_state; Type: INDEX; Schema: voice; Owner: -
--

CREATE INDEX idx_voice_participant_call_state ON voice.call_participant USING btree (organization_id, call_session_id, state);


--
-- Name: idx_voice_participant_employee; Type: INDEX; Schema: voice; Owner: -
--

CREATE INDEX idx_voice_participant_employee ON voice.call_participant USING btree (organization_id, employee_id, updated_at DESC);


--
-- Name: idx_voice_participant_identity; Type: INDEX; Schema: voice; Owner: -
--

CREATE UNIQUE INDEX idx_voice_participant_identity ON voice.call_participant USING btree (organization_id, livekit_identity);


--
-- Name: attendee attendee_organization_id_fkey; Type: FK CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.attendee
    ADD CONSTRAINT attendee_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: audit_entry audit_entry_organization_id_fkey; Type: FK CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.audit_entry
    ADD CONSTRAINT audit_entry_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: booking_link booking_link_organization_id_fkey; Type: FK CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.booking_link
    ADD CONSTRAINT booking_link_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: check_in check_in_organization_id_fkey; Type: FK CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.check_in
    ADD CONSTRAINT check_in_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: delegation delegation_organization_id_fkey; Type: FK CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.delegation
    ADD CONSTRAINT delegation_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: event event_organization_id_fkey; Type: FK CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.event
    ADD CONSTRAINT event_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: event_reminder event_reminder_organization_id_fkey; Type: FK CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.event_reminder
    ADD CONSTRAINT event_reminder_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: attendee fk_attendee_employee; Type: FK CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.attendee
    ADD CONSTRAINT fk_attendee_employee FOREIGN KEY (organization_id, employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE RESTRICT;


--
-- Name: attendee fk_attendee_event; Type: FK CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.attendee
    ADD CONSTRAINT fk_attendee_event FOREIGN KEY (organization_id, event_id) REFERENCES calendar.event(organization_id, id) ON DELETE CASCADE;


--
-- Name: audit_entry fk_audit_actor; Type: FK CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.audit_entry
    ADD CONSTRAINT fk_audit_actor FOREIGN KEY (organization_id, actor_id) REFERENCES organization.employee(organization_id, id) ON DELETE RESTRICT;


--
-- Name: audit_entry fk_audit_event; Type: FK CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.audit_entry
    ADD CONSTRAINT fk_audit_event FOREIGN KEY (organization_id, event_id) REFERENCES calendar.event(organization_id, id) ON DELETE RESTRICT;


--
-- Name: booking_link fk_booking_link_owner; Type: FK CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.booking_link
    ADD CONSTRAINT fk_booking_link_owner FOREIGN KEY (organization_id, owner_id) REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE;


--
-- Name: event_reminder fk_calendar_event_reminder_event; Type: FK CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.event_reminder
    ADD CONSTRAINT fk_calendar_event_reminder_event FOREIGN KEY (organization_id, event_id) REFERENCES calendar.event(organization_id, id) ON DELETE CASCADE;


--
-- Name: check_in fk_check_in_employee; Type: FK CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.check_in
    ADD CONSTRAINT fk_check_in_employee FOREIGN KEY (organization_id, employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE RESTRICT;


--
-- Name: check_in fk_check_in_event; Type: FK CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.check_in
    ADD CONSTRAINT fk_check_in_event FOREIGN KEY (organization_id, event_id) REFERENCES calendar.event(organization_id, id) ON DELETE RESTRICT;


--
-- Name: delegation fk_delegation_delegate; Type: FK CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.delegation
    ADD CONSTRAINT fk_delegation_delegate FOREIGN KEY (organization_id, delegate_id) REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE;


--
-- Name: delegation fk_delegation_owner; Type: FK CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.delegation
    ADD CONSTRAINT fk_delegation_owner FOREIGN KEY (organization_id, owner_id) REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE;


--
-- Name: event fk_event_organizer; Type: FK CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.event
    ADD CONSTRAINT fk_event_organizer FOREIGN KEY (organization_id, organizer_id) REFERENCES organization.employee(organization_id, id) ON DELETE RESTRICT;


--
-- Name: recurrence_exception fk_recurrence_exception_changed_by; Type: FK CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.recurrence_exception
    ADD CONSTRAINT fk_recurrence_exception_changed_by FOREIGN KEY (organization_id, changed_by_id) REFERENCES organization.employee(organization_id, id) ON DELETE RESTRICT;


--
-- Name: recurrence_exception fk_recurrence_exception_new_event; Type: FK CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.recurrence_exception
    ADD CONSTRAINT fk_recurrence_exception_new_event FOREIGN KEY (organization_id, new_event_id) REFERENCES calendar.event(organization_id, id) ON DELETE CASCADE;


--
-- Name: recurrence_exception fk_recurrence_exception_series; Type: FK CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.recurrence_exception
    ADD CONSTRAINT fk_recurrence_exception_series FOREIGN KEY (organization_id, series_id) REFERENCES calendar.event(organization_id, id) ON DELETE CASCADE;


--
-- Name: resource_acl fk_resource_acl_employee; Type: FK CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.resource_acl
    ADD CONSTRAINT fk_resource_acl_employee FOREIGN KEY (organization_id, employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE;


--
-- Name: resource_acl fk_resource_acl_resource; Type: FK CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.resource_acl
    ADD CONSTRAINT fk_resource_acl_resource FOREIGN KEY (organization_id, resource_id) REFERENCES calendar.resource(organization_id, id) ON DELETE CASCADE;


--
-- Name: resource_booking fk_resource_booking_booked_by; Type: FK CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.resource_booking
    ADD CONSTRAINT fk_resource_booking_booked_by FOREIGN KEY (organization_id, booked_by_id) REFERENCES organization.employee(organization_id, id) ON DELETE RESTRICT;


--
-- Name: resource_booking fk_resource_booking_event; Type: FK CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.resource_booking
    ADD CONSTRAINT fk_resource_booking_event FOREIGN KEY (organization_id, event_id) REFERENCES calendar.event(organization_id, id) ON DELETE CASCADE;


--
-- Name: resource_booking fk_resource_booking_resource; Type: FK CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.resource_booking
    ADD CONSTRAINT fk_resource_booking_resource FOREIGN KEY (organization_id, resource_id) REFERENCES calendar.resource(organization_id, id) ON DELETE RESTRICT;


--
-- Name: working_hours fk_working_hours_employee; Type: FK CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.working_hours
    ADD CONSTRAINT fk_working_hours_employee FOREIGN KEY (organization_id, employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE;


--
-- Name: recurrence_exception recurrence_exception_organization_id_fkey; Type: FK CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.recurrence_exception
    ADD CONSTRAINT recurrence_exception_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: resource_acl resource_acl_organization_id_fkey; Type: FK CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.resource_acl
    ADD CONSTRAINT resource_acl_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: resource_booking resource_booking_organization_id_fkey; Type: FK CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.resource_booking
    ADD CONSTRAINT resource_booking_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: resource resource_organization_id_fkey; Type: FK CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.resource
    ADD CONSTRAINT resource_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: working_hours working_hours_organization_id_fkey; Type: FK CONSTRAINT; Schema: calendar; Owner: -
--

ALTER TABLE ONLY calendar.working_hours
    ADD CONSTRAINT working_hours_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: channel_membership channel_membership_organization_id_fkey; Type: FK CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.channel_membership
    ADD CONSTRAINT channel_membership_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: channel channel_organization_id_fkey; Type: FK CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.channel
    ADD CONSTRAINT channel_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: channel fk_channel_creator; Type: FK CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.channel
    ADD CONSTRAINT fk_channel_creator FOREIGN KEY (organization_id, created_by_employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE RESTRICT;


--
-- Name: channel_membership fk_channel_membership_channel; Type: FK CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.channel_membership
    ADD CONSTRAINT fk_channel_membership_channel FOREIGN KEY (organization_id, channel_id) REFERENCES chat.channel(organization_id, id) ON DELETE CASCADE;


--
-- Name: channel_membership fk_channel_membership_employee; Type: FK CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.channel_membership
    ADD CONSTRAINT fk_channel_membership_employee FOREIGN KEY (organization_id, employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE;


--
-- Name: channel_membership fk_channel_membership_last_viewed_message; Type: FK CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.channel_membership
    ADD CONSTRAINT fk_channel_membership_last_viewed_message FOREIGN KEY (organization_id, last_viewed_message_id) REFERENCES chat.message(organization_id, id) ON DELETE RESTRICT;


--
-- Name: message fk_message_author; Type: FK CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.message
    ADD CONSTRAINT fk_message_author FOREIGN KEY (organization_id, author_employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE RESTRICT;


--
-- Name: message fk_message_channel; Type: FK CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.message
    ADD CONSTRAINT fk_message_channel FOREIGN KEY (organization_id, channel_id) REFERENCES chat.channel(organization_id, id) ON DELETE CASCADE;


--
-- Name: message fk_message_parent; Type: FK CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.message
    ADD CONSTRAINT fk_message_parent FOREIGN KEY (organization_id, parent_message_id) REFERENCES chat.message(organization_id, id) ON DELETE CASCADE;


--
-- Name: reaction fk_reaction_employee; Type: FK CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.reaction
    ADD CONSTRAINT fk_reaction_employee FOREIGN KEY (organization_id, employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE;


--
-- Name: reaction fk_reaction_message; Type: FK CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.reaction
    ADD CONSTRAINT fk_reaction_message FOREIGN KEY (organization_id, message_id) REFERENCES chat.message(organization_id, id) ON DELETE CASCADE;


--
-- Name: typing_indicator fk_typing_indicator_channel; Type: FK CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.typing_indicator
    ADD CONSTRAINT fk_typing_indicator_channel FOREIGN KEY (organization_id, channel_id) REFERENCES chat.channel(organization_id, id) ON DELETE CASCADE;


--
-- Name: typing_indicator fk_typing_indicator_employee; Type: FK CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.typing_indicator
    ADD CONSTRAINT fk_typing_indicator_employee FOREIGN KEY (organization_id, employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE;


--
-- Name: user_chat_config fk_user_chat_config_employee; Type: FK CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.user_chat_config
    ADD CONSTRAINT fk_user_chat_config_employee FOREIGN KEY (organization_id, employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE;


--
-- Name: message message_organization_id_fkey; Type: FK CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.message
    ADD CONSTRAINT message_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: reaction reaction_organization_id_fkey; Type: FK CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.reaction
    ADD CONSTRAINT reaction_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: typing_indicator typing_indicator_organization_id_fkey; Type: FK CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.typing_indicator
    ADD CONSTRAINT typing_indicator_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: user_chat_config user_chat_config_organization_id_fkey; Type: FK CONSTRAINT; Schema: chat; Owner: -
--

ALTER TABLE ONLY chat.user_chat_config
    ADD CONSTRAINT user_chat_config_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: custom_field_definition custom_field_definition_organization_id_fkey; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.custom_field_definition
    ADD CONSTRAINT custom_field_definition_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: custom_field_value custom_field_value_organization_id_fkey; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.custom_field_value
    ADD CONSTRAINT custom_field_value_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: evidence_requirement evidence_requirement_organization_id_fkey; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.evidence_requirement
    ADD CONSTRAINT evidence_requirement_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: evidence_submission evidence_submission_organization_id_fkey; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.evidence_submission
    ADD CONSTRAINT evidence_submission_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: task_assignee fk_assignee_assigned_by; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.task_assignee
    ADD CONSTRAINT fk_assignee_assigned_by FOREIGN KEY (organization_id, assigned_by_employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE RESTRICT;


--
-- Name: task_assignee fk_assignee_employee; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.task_assignee
    ADD CONSTRAINT fk_assignee_employee FOREIGN KEY (organization_id, employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE;


--
-- Name: task_assignee fk_assignee_task; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.task_assignee
    ADD CONSTRAINT fk_assignee_task FOREIGN KEY (organization_id, task_id) REFERENCES collaboration.task(organization_id, id) ON DELETE CASCADE;


--
-- Name: channel_task_destination fk_channel_task_destination_channel; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.channel_task_destination
    ADD CONSTRAINT fk_channel_task_destination_channel FOREIGN KEY (organization_id, channel_id) REFERENCES chat.channel(organization_id, id) ON DELETE CASCADE;


--
-- Name: channel_task_destination fk_channel_task_destination_organization; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.channel_task_destination
    ADD CONSTRAINT fk_channel_task_destination_organization FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: channel_task_destination fk_channel_task_destination_project; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.channel_task_destination
    ADD CONSTRAINT fk_channel_task_destination_project FOREIGN KEY (organization_id, project_id) REFERENCES collaboration.project(organization_id, id) ON DELETE CASCADE;


--
-- Name: channel_task_destination fk_channel_task_destination_set_by; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.channel_task_destination
    ADD CONSTRAINT fk_channel_task_destination_set_by FOREIGN KEY (organization_id, set_by_employee_id) REFERENCES organization.employee(organization_id, id);


--
-- Name: evidence_submission fk_es_evidence_req; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.evidence_submission
    ADD CONSTRAINT fk_es_evidence_req FOREIGN KEY (organization_id, evidence_requirement_id) REFERENCES collaboration.evidence_requirement(organization_id, id) ON DELETE RESTRICT;


--
-- Name: evidence_submission fk_es_reviewer; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.evidence_submission
    ADD CONSTRAINT fk_es_reviewer FOREIGN KEY (organization_id, reviewed_by_employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE RESTRICT;


--
-- Name: evidence_submission fk_es_submitter; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.evidence_submission
    ADD CONSTRAINT fk_es_submitter FOREIGN KEY (organization_id, submitted_by_employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE RESTRICT;


--
-- Name: evidence_submission fk_es_task; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.evidence_submission
    ADD CONSTRAINT fk_es_task FOREIGN KEY (organization_id, task_id) REFERENCES collaboration.task(organization_id, id) ON DELETE CASCADE;


--
-- Name: evidence_requirement fk_evidence_req_ritual_def; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.evidence_requirement
    ADD CONSTRAINT fk_evidence_req_ritual_def FOREIGN KEY (organization_id, ritual_definition_id) REFERENCES collaboration.ritual_definition(organization_id, id) ON DELETE CASCADE;


--
-- Name: workflow_rule_execution fk_execution_rule; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.workflow_rule_execution
    ADD CONSTRAINT fk_execution_rule FOREIGN KEY (organization_id, rule_id) REFERENCES collaboration.workflow_rule(organization_id, id) ON DELETE CASCADE;


--
-- Name: workflow_rule_execution fk_execution_task; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.workflow_rule_execution
    ADD CONSTRAINT fk_execution_task FOREIGN KEY (organization_id, task_id) REFERENCES collaboration.task(organization_id, id) ON DELETE CASCADE;


--
-- Name: workflow_rule_execution fk_execution_triggered_by; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.workflow_rule_execution
    ADD CONSTRAINT fk_execution_triggered_by FOREIGN KEY (organization_id, triggered_by_employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE RESTRICT;


--
-- Name: custom_field_definition fk_field_def_project; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.custom_field_definition
    ADD CONSTRAINT fk_field_def_project FOREIGN KEY (organization_id, project_id) REFERENCES collaboration.project(organization_id, id) ON DELETE CASCADE;


--
-- Name: custom_field_value fk_field_value_definition; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.custom_field_value
    ADD CONSTRAINT fk_field_value_definition FOREIGN KEY (organization_id, field_definition_id) REFERENCES collaboration.custom_field_definition(organization_id, id) ON DELETE CASCADE;


--
-- Name: custom_field_value fk_field_value_task; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.custom_field_value
    ADD CONSTRAINT fk_field_value_task FOREIGN KEY (organization_id, task_id) REFERENCES collaboration.task(organization_id, id) ON DELETE CASCADE;


--
-- Name: task_level fk_level_project; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.task_level
    ADD CONSTRAINT fk_level_project FOREIGN KEY (organization_id, project_id) REFERENCES collaboration.project(organization_id, id) ON DELETE CASCADE;


--
-- Name: project_membership fk_membership_employee; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.project_membership
    ADD CONSTRAINT fk_membership_employee FOREIGN KEY (organization_id, employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE;


--
-- Name: project_membership fk_membership_invited_by; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.project_membership
    ADD CONSTRAINT fk_membership_invited_by FOREIGN KEY (organization_id, invited_by_employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE RESTRICT;


--
-- Name: project_membership fk_membership_project; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.project_membership
    ADD CONSTRAINT fk_membership_project FOREIGN KEY (organization_id, project_id) REFERENCES collaboration.project(organization_id, id) ON DELETE CASCADE;


--
-- Name: project fk_project_owner; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.project
    ADD CONSTRAINT fk_project_owner FOREIGN KEY (organization_id, owner_employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE RESTRICT;


--
-- Name: ritual_definition_assignee fk_rda_employee; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.ritual_definition_assignee
    ADD CONSTRAINT fk_rda_employee FOREIGN KEY (organization_id, employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE;


--
-- Name: ritual_definition_assignee fk_rda_ritual_def; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.ritual_definition_assignee
    ADD CONSTRAINT fk_rda_ritual_def FOREIGN KEY (organization_id, ritual_definition_id) REFERENCES collaboration.ritual_definition(organization_id, id) ON DELETE CASCADE;


--
-- Name: ritual_definition_department_pool fk_rddp_department; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.ritual_definition_department_pool
    ADD CONSTRAINT fk_rddp_department FOREIGN KEY (organization_id, department_id) REFERENCES organization.department(organization_id, id) ON DELETE CASCADE;


--
-- Name: ritual_definition_department_pool fk_rddp_ritual_def; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.ritual_definition_department_pool
    ADD CONSTRAINT fk_rddp_ritual_def FOREIGN KEY (organization_id, ritual_definition_id) REFERENCES collaboration.ritual_definition(organization_id, id) ON DELETE CASCADE;


--
-- Name: ritual_definition fk_ritual_def_creator; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.ritual_definition
    ADD CONSTRAINT fk_ritual_def_creator FOREIGN KEY (organization_id, created_by_employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE RESTRICT;


--
-- Name: ritual_definition fk_ritual_def_project; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.ritual_definition
    ADD CONSTRAINT fk_ritual_def_project FOREIGN KEY (organization_id, project_id) REFERENCES collaboration.project(organization_id, id) ON DELETE CASCADE;


--
-- Name: workflow_rule fk_rule_project; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.workflow_rule
    ADD CONSTRAINT fk_rule_project FOREIGN KEY (organization_id, project_id) REFERENCES collaboration.project(organization_id, id) ON DELETE CASCADE;


--
-- Name: workflow_rule fk_rule_trigger_field; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.workflow_rule
    ADD CONSTRAINT fk_rule_trigger_field FOREIGN KEY (organization_id, trigger_field_id) REFERENCES collaboration.custom_field_definition(organization_id, id) ON DELETE CASCADE;


--
-- Name: workflow_rule fk_rule_trigger_state; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.workflow_rule
    ADD CONSTRAINT fk_rule_trigger_state FOREIGN KEY (organization_id, trigger_state_id) REFERENCES collaboration.project_state(organization_id, id) ON DELETE CASCADE;


--
-- Name: project_state fk_state_project; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.project_state
    ADD CONSTRAINT fk_state_project FOREIGN KEY (organization_id, project_id) REFERENCES collaboration.project(organization_id, id) ON DELETE CASCADE;


--
-- Name: task fk_task_channel; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.task
    ADD CONSTRAINT fk_task_channel FOREIGN KEY (organization_id, channel_id) REFERENCES chat.channel(organization_id, id) ON DELETE RESTRICT;


--
-- Name: task fk_task_description; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.task
    ADD CONSTRAINT fk_task_description FOREIGN KEY (organization_id, description_document_id) REFERENCES docs.document(organization_id, id) ON DELETE RESTRICT;


--
-- Name: task fk_task_level; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.task
    ADD CONSTRAINT fk_task_level FOREIGN KEY (organization_id, level_id) REFERENCES collaboration.task_level(organization_id, id) ON DELETE RESTRICT;


--
-- Name: task fk_task_parent; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.task
    ADD CONSTRAINT fk_task_parent FOREIGN KEY (organization_id, parent_task_id) REFERENCES collaboration.task(organization_id, id) ON DELETE RESTRICT;


--
-- Name: task fk_task_project; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.task
    ADD CONSTRAINT fk_task_project FOREIGN KEY (organization_id, project_id) REFERENCES collaboration.project(organization_id, id) ON DELETE CASCADE;


--
-- Name: task fk_task_reporter; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.task
    ADD CONSTRAINT fk_task_reporter FOREIGN KEY (organization_id, reporter_employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE RESTRICT;


--
-- Name: task fk_task_ritual_definition; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.task
    ADD CONSTRAINT fk_task_ritual_definition FOREIGN KEY (organization_id, ritual_definition_id) REFERENCES collaboration.ritual_definition(organization_id, id) ON DELETE RESTRICT;


--
-- Name: task fk_task_source_channel; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.task
    ADD CONSTRAINT fk_task_source_channel FOREIGN KEY (organization_id, source_channel_id) REFERENCES chat.channel(organization_id, id) ON DELETE SET NULL;


--
-- Name: task fk_task_source_message; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.task
    ADD CONSTRAINT fk_task_source_message FOREIGN KEY (organization_id, source_message_id) REFERENCES chat.message(organization_id, id) ON DELETE SET NULL;


--
-- Name: task fk_task_state; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.task
    ADD CONSTRAINT fk_task_state FOREIGN KEY (organization_id, state_id) REFERENCES collaboration.project_state(organization_id, id) ON DELETE RESTRICT;


--
-- Name: saved_view fk_view_employee; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.saved_view
    ADD CONSTRAINT fk_view_employee FOREIGN KEY (organization_id, employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE;


--
-- Name: saved_view fk_view_project; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.saved_view
    ADD CONSTRAINT fk_view_project FOREIGN KEY (organization_id, project_id) REFERENCES collaboration.project(organization_id, id) ON DELETE CASCADE;


--
-- Name: project_membership project_membership_organization_id_fkey; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.project_membership
    ADD CONSTRAINT project_membership_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: project project_organization_id_fkey; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.project
    ADD CONSTRAINT project_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: project_state project_state_organization_id_fkey; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.project_state
    ADD CONSTRAINT project_state_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: ritual_definition_assignee ritual_definition_assignee_organization_id_fkey; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.ritual_definition_assignee
    ADD CONSTRAINT ritual_definition_assignee_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: ritual_definition_department_pool ritual_definition_department_pool_organization_id_fkey; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.ritual_definition_department_pool
    ADD CONSTRAINT ritual_definition_department_pool_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: ritual_definition ritual_definition_organization_id_fkey; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.ritual_definition
    ADD CONSTRAINT ritual_definition_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: saved_view saved_view_organization_id_fkey; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.saved_view
    ADD CONSTRAINT saved_view_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: task_assignee task_assignee_organization_id_fkey; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.task_assignee
    ADD CONSTRAINT task_assignee_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: task_level task_level_organization_id_fkey; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.task_level
    ADD CONSTRAINT task_level_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: task task_organization_id_fkey; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.task
    ADD CONSTRAINT task_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: workflow_rule_execution workflow_rule_execution_organization_id_fkey; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.workflow_rule_execution
    ADD CONSTRAINT workflow_rule_execution_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: workflow_rule workflow_rule_organization_id_fkey; Type: FK CONSTRAINT; Schema: collaboration; Owner: -
--

ALTER TABLE ONLY collaboration.workflow_rule
    ADD CONSTRAINT workflow_rule_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: account_deletion account_deletion_organization_id_fkey; Type: FK CONSTRAINT; Schema: compliance; Owner: -
--

ALTER TABLE ONLY compliance.account_deletion
    ADD CONSTRAINT account_deletion_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: block block_organization_id_fkey; Type: FK CONSTRAINT; Schema: compliance; Owner: -
--

ALTER TABLE ONLY compliance.block
    ADD CONSTRAINT block_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: content_report content_report_organization_id_fkey; Type: FK CONSTRAINT; Schema: compliance; Owner: -
--

ALTER TABLE ONLY compliance.content_report
    ADD CONSTRAINT content_report_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: block fk_compliance_block_blocked; Type: FK CONSTRAINT; Schema: compliance; Owner: -
--

ALTER TABLE ONLY compliance.block
    ADD CONSTRAINT fk_compliance_block_blocked FOREIGN KEY (organization_id, blocked_employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE;


--
-- Name: block fk_compliance_block_blocker; Type: FK CONSTRAINT; Schema: compliance; Owner: -
--

ALTER TABLE ONLY compliance.block
    ADD CONSTRAINT fk_compliance_block_blocker FOREIGN KEY (organization_id, blocker_employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE;


--
-- Name: content_report fk_compliance_content_report_reported; Type: FK CONSTRAINT; Schema: compliance; Owner: -
--

ALTER TABLE ONLY compliance.content_report
    ADD CONSTRAINT fk_compliance_content_report_reported FOREIGN KEY (organization_id, reported_employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE;


--
-- Name: content_report fk_compliance_content_report_reporter; Type: FK CONSTRAINT; Schema: compliance; Owner: -
--

ALTER TABLE ONLY compliance.content_report
    ADD CONSTRAINT fk_compliance_content_report_reporter FOREIGN KEY (organization_id, reporter_employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE;


--
-- Name: content_report fk_compliance_content_report_reviewer; Type: FK CONSTRAINT; Schema: compliance; Owner: -
--

ALTER TABLE ONLY compliance.content_report
    ADD CONSTRAINT fk_compliance_content_report_reviewer FOREIGN KEY (organization_id, reviewed_by_employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE;


--
-- Name: removal_request fk_compliance_removal_request_decider; Type: FK CONSTRAINT; Schema: compliance; Owner: -
--

ALTER TABLE ONLY compliance.removal_request
    ADD CONSTRAINT fk_compliance_removal_request_decider FOREIGN KEY (organization_id, decided_by_employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE;


--
-- Name: removal_request fk_compliance_removal_request_employee; Type: FK CONSTRAINT; Schema: compliance; Owner: -
--

ALTER TABLE ONLY compliance.removal_request
    ADD CONSTRAINT fk_compliance_removal_request_employee FOREIGN KEY (organization_id, employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE;


--
-- Name: removal_request removal_request_organization_id_fkey; Type: FK CONSTRAINT; Schema: compliance; Owner: -
--

ALTER TABLE ONLY compliance.removal_request
    ADD CONSTRAINT removal_request_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: comment comment_organization_id_fkey; Type: FK CONSTRAINT; Schema: docs; Owner: -
--

ALTER TABLE ONLY docs.comment
    ADD CONSTRAINT comment_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: comment_reply comment_reply_organization_id_fkey; Type: FK CONSTRAINT; Schema: docs; Owner: -
--

ALTER TABLE ONLY docs.comment_reply
    ADD CONSTRAINT comment_reply_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: document_access document_access_organization_id_fkey; Type: FK CONSTRAINT; Schema: docs; Owner: -
--

ALTER TABLE ONLY docs.document_access
    ADD CONSTRAINT document_access_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: document_editor document_editor_organization_id_fkey; Type: FK CONSTRAINT; Schema: docs; Owner: -
--

ALTER TABLE ONLY docs.document_editor
    ADD CONSTRAINT document_editor_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: document document_organization_id_fkey; Type: FK CONSTRAINT; Schema: docs; Owner: -
--

ALTER TABLE ONLY docs.document
    ADD CONSTRAINT document_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: document_reaction document_reaction_organization_id_fkey; Type: FK CONSTRAINT; Schema: docs; Owner: -
--

ALTER TABLE ONLY docs.document_reaction
    ADD CONSTRAINT document_reaction_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: document_slug_history document_slug_history_organization_id_fkey; Type: FK CONSTRAINT; Schema: docs; Owner: -
--

ALTER TABLE ONLY docs.document_slug_history
    ADD CONSTRAINT document_slug_history_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: document_version document_version_organization_id_fkey; Type: FK CONSTRAINT; Schema: docs; Owner: -
--

ALTER TABLE ONLY docs.document_version
    ADD CONSTRAINT document_version_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: document_access fk_access_document; Type: FK CONSTRAINT; Schema: docs; Owner: -
--

ALTER TABLE ONLY docs.document_access
    ADD CONSTRAINT fk_access_document FOREIGN KEY (organization_id, document_id) REFERENCES docs.document(organization_id, id) ON DELETE CASCADE;


--
-- Name: document_access fk_access_grantor; Type: FK CONSTRAINT; Schema: docs; Owner: -
--

ALTER TABLE ONLY docs.document_access
    ADD CONSTRAINT fk_access_grantor FOREIGN KEY (organization_id, granted_by_employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE RESTRICT;


--
-- Name: comment fk_comment_author; Type: FK CONSTRAINT; Schema: docs; Owner: -
--

ALTER TABLE ONLY docs.comment
    ADD CONSTRAINT fk_comment_author FOREIGN KEY (organization_id, author_employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE RESTRICT;


--
-- Name: comment fk_comment_document; Type: FK CONSTRAINT; Schema: docs; Owner: -
--

ALTER TABLE ONLY docs.comment
    ADD CONSTRAINT fk_comment_document FOREIGN KEY (organization_id, document_id) REFERENCES docs.document(organization_id, id) ON DELETE CASCADE;


--
-- Name: comment fk_comment_resolver; Type: FK CONSTRAINT; Schema: docs; Owner: -
--

ALTER TABLE ONLY docs.comment
    ADD CONSTRAINT fk_comment_resolver FOREIGN KEY (organization_id, resolved_by_employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE RESTRICT;


--
-- Name: document fk_document_owner; Type: FK CONSTRAINT; Schema: docs; Owner: -
--

ALTER TABLE ONLY docs.document
    ADD CONSTRAINT fk_document_owner FOREIGN KEY (organization_id, owner_employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE RESTRICT;


--
-- Name: document fk_document_parent; Type: FK CONSTRAINT; Schema: docs; Owner: -
--

ALTER TABLE ONLY docs.document
    ADD CONSTRAINT fk_document_parent FOREIGN KEY (organization_id, parent_document_id) REFERENCES docs.document(organization_id, id) ON DELETE RESTRICT;


--
-- Name: document_editor fk_editor_document; Type: FK CONSTRAINT; Schema: docs; Owner: -
--

ALTER TABLE ONLY docs.document_editor
    ADD CONSTRAINT fk_editor_document FOREIGN KEY (organization_id, document_id) REFERENCES docs.document(organization_id, id) ON DELETE CASCADE;


--
-- Name: document_editor fk_editor_employee; Type: FK CONSTRAINT; Schema: docs; Owner: -
--

ALTER TABLE ONLY docs.document_editor
    ADD CONSTRAINT fk_editor_employee FOREIGN KEY (organization_id, employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE;


--
-- Name: section_embed fk_embed_source_document; Type: FK CONSTRAINT; Schema: docs; Owner: -
--

ALTER TABLE ONLY docs.section_embed
    ADD CONSTRAINT fk_embed_source_document FOREIGN KEY (organization_id, source_document_id) REFERENCES docs.document(organization_id, id) ON DELETE CASCADE;


--
-- Name: section_embed fk_embed_target_document; Type: FK CONSTRAINT; Schema: docs; Owner: -
--

ALTER TABLE ONLY docs.section_embed
    ADD CONSTRAINT fk_embed_target_document FOREIGN KEY (organization_id, target_document_id) REFERENCES docs.document(organization_id, id) ON DELETE CASCADE;


--
-- Name: document_reaction fk_reaction_document; Type: FK CONSTRAINT; Schema: docs; Owner: -
--

ALTER TABLE ONLY docs.document_reaction
    ADD CONSTRAINT fk_reaction_document FOREIGN KEY (organization_id, document_id) REFERENCES docs.document(organization_id, id) ON DELETE CASCADE;


--
-- Name: document_reaction fk_reaction_employee; Type: FK CONSTRAINT; Schema: docs; Owner: -
--

ALTER TABLE ONLY docs.document_reaction
    ADD CONSTRAINT fk_reaction_employee FOREIGN KEY (organization_id, employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE;


--
-- Name: comment_reply fk_reply_author; Type: FK CONSTRAINT; Schema: docs; Owner: -
--

ALTER TABLE ONLY docs.comment_reply
    ADD CONSTRAINT fk_reply_author FOREIGN KEY (organization_id, author_employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE RESTRICT;


--
-- Name: comment_reply fk_reply_comment; Type: FK CONSTRAINT; Schema: docs; Owner: -
--

ALTER TABLE ONLY docs.comment_reply
    ADD CONSTRAINT fk_reply_comment FOREIGN KEY (organization_id, comment_id) REFERENCES docs.comment(organization_id, id) ON DELETE CASCADE;


--
-- Name: document_slug_history fk_slug_history_document; Type: FK CONSTRAINT; Schema: docs; Owner: -
--

ALTER TABLE ONLY docs.document_slug_history
    ADD CONSTRAINT fk_slug_history_document FOREIGN KEY (organization_id, document_id) REFERENCES docs.document(organization_id, id) ON DELETE CASCADE;


--
-- Name: document_version fk_version_author; Type: FK CONSTRAINT; Schema: docs; Owner: -
--

ALTER TABLE ONLY docs.document_version
    ADD CONSTRAINT fk_version_author FOREIGN KEY (organization_id, author_employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE RESTRICT;


--
-- Name: document_version fk_version_document; Type: FK CONSTRAINT; Schema: docs; Owner: -
--

ALTER TABLE ONLY docs.document_version
    ADD CONSTRAINT fk_version_document FOREIGN KEY (organization_id, document_id) REFERENCES docs.document(organization_id, id) ON DELETE CASCADE;


--
-- Name: section_embed section_embed_organization_id_fkey; Type: FK CONSTRAINT; Schema: docs; Owner: -
--

ALTER TABLE ONLY docs.section_embed
    ADD CONSTRAINT section_embed_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: file_access_rule file_access_rule_organization_id_fkey; Type: FK CONSTRAINT; Schema: files; Owner: -
--

ALTER TABLE ONLY files.file_access_rule
    ADD CONSTRAINT file_access_rule_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: file_content_index file_content_index_organization_id_fkey; Type: FK CONSTRAINT; Schema: files; Owner: -
--

ALTER TABLE ONLY files.file_content_index
    ADD CONSTRAINT file_content_index_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: file_deletion_log file_deletion_log_organization_id_fkey; Type: FK CONSTRAINT; Schema: files; Owner: -
--

ALTER TABLE ONLY files.file_deletion_log
    ADD CONSTRAINT file_deletion_log_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: file_metadata file_metadata_organization_id_fkey; Type: FK CONSTRAINT; Schema: files; Owner: -
--

ALTER TABLE ONLY files.file_metadata
    ADD CONSTRAINT file_metadata_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: file_pdf_conversion file_pdf_conversion_organization_id_fkey; Type: FK CONSTRAINT; Schema: files; Owner: -
--

ALTER TABLE ONLY files.file_pdf_conversion
    ADD CONSTRAINT file_pdf_conversion_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: file_quota file_quota_organization_id_fkey; Type: FK CONSTRAINT; Schema: files; Owner: -
--

ALTER TABLE ONLY files.file_quota
    ADD CONSTRAINT file_quota_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: file_access_rule fk_file_access_file; Type: FK CONSTRAINT; Schema: files; Owner: -
--

ALTER TABLE ONLY files.file_access_rule
    ADD CONSTRAINT fk_file_access_file FOREIGN KEY (organization_id, file_id) REFERENCES files.file_metadata(organization_id, id) ON DELETE CASCADE;


--
-- Name: file_content_index fk_file_content_file; Type: FK CONSTRAINT; Schema: files; Owner: -
--

ALTER TABLE ONLY files.file_content_index
    ADD CONSTRAINT fk_file_content_file FOREIGN KEY (organization_id, file_id) REFERENCES files.file_metadata(organization_id, id) ON DELETE CASCADE;


--
-- Name: file_deletion_log fk_file_deletion_deleter; Type: FK CONSTRAINT; Schema: files; Owner: -
--

ALTER TABLE ONLY files.file_deletion_log
    ADD CONSTRAINT fk_file_deletion_deleter FOREIGN KEY (organization_id, deleted_by_employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE RESTRICT;


--
-- Name: file_metadata fk_file_uploader; Type: FK CONSTRAINT; Schema: files; Owner: -
--

ALTER TABLE ONLY files.file_metadata
    ADD CONSTRAINT fk_file_uploader FOREIGN KEY (organization_id, uploaded_by_employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE RESTRICT;


--
-- Name: file_pdf_conversion fk_pdf_conversion_file; Type: FK CONSTRAINT; Schema: files; Owner: -
--

ALTER TABLE ONLY files.file_pdf_conversion
    ADD CONSTRAINT fk_pdf_conversion_file FOREIGN KEY (organization_id, original_file_id) REFERENCES files.file_metadata(organization_id, id) ON DELETE CASCADE;


--
-- Name: events events_workflow_name_shard_run_id_fkey; Type: FK CONSTRAINT; Schema: flows; Owner: -
--

ALTER TABLE ONLY flows.events
    ADD CONSTRAINT events_workflow_name_shard_run_id_fkey FOREIGN KEY (workflow_name_shard, run_id) REFERENCES flows.runs(workflow_name_shard, run_id) ON DELETE CASCADE;


--
-- Name: random random_workflow_name_shard_run_id_fkey; Type: FK CONSTRAINT; Schema: flows; Owner: -
--

ALTER TABLE ONLY flows.random
    ADD CONSTRAINT random_workflow_name_shard_run_id_fkey FOREIGN KEY (workflow_name_shard, run_id) REFERENCES flows.runs(workflow_name_shard, run_id) ON DELETE CASCADE;


--
-- Name: steps steps_workflow_name_shard_run_id_fkey; Type: FK CONSTRAINT; Schema: flows; Owner: -
--

ALTER TABLE ONLY flows.steps
    ADD CONSTRAINT steps_workflow_name_shard_run_id_fkey FOREIGN KEY (workflow_name_shard, run_id) REFERENCES flows.runs(workflow_name_shard, run_id) ON DELETE CASCADE;


--
-- Name: waits waits_workflow_name_shard_run_id_fkey; Type: FK CONSTRAINT; Schema: flows; Owner: -
--

ALTER TABLE ONLY flows.waits
    ADD CONSTRAINT waits_workflow_name_shard_run_id_fkey FOREIGN KEY (workflow_name_shard, run_id) REFERENCES flows.runs(workflow_name_shard, run_id) ON DELETE CASCADE;


--
-- Name: account_lockout account_lockout_organization_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.account_lockout
    ADD CONSTRAINT account_lockout_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: credential credential_organization_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.credential
    ADD CONSTRAINT credential_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: credential fk_credential_identity; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.credential
    ADD CONSTRAINT fk_credential_identity FOREIGN KEY (organization_id, identity_id) REFERENCES iam.identity(organization_id, id) ON DELETE CASCADE;


--
-- Name: employee_role fk_employee_role_employee; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.employee_role
    ADD CONSTRAINT fk_employee_role_employee FOREIGN KEY (organization_id, employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE;


--
-- Name: employee_role fk_employee_role_role; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.employee_role
    ADD CONSTRAINT fk_employee_role_role FOREIGN KEY (organization_id, role_id) REFERENCES iam.role(organization_id, id) ON DELETE CASCADE;


--
-- Name: account_lockout fk_lockout_identity; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.account_lockout
    ADD CONSTRAINT fk_lockout_identity FOREIGN KEY (organization_id, identity_id) REFERENCES iam.identity(organization_id, id) ON DELETE CASCADE;


--
-- Name: role_permission fk_role_permission_role; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.role_permission
    ADD CONSTRAINT fk_role_permission_role FOREIGN KEY (organization_id, role_id) REFERENCES iam.role(organization_id, id) ON DELETE CASCADE;


--
-- Name: user_preference fk_user_preference_employee; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.user_preference
    ADD CONSTRAINT fk_user_preference_employee FOREIGN KEY (organization_id, employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE;


--
-- Name: identity identity_organization_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.identity
    ADD CONSTRAINT identity_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: invitation invitation_invited_by_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.invitation
    ADD CONSTRAINT invitation_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES iam."user"(id);


--
-- Name: invitation invitation_organization_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.invitation
    ADD CONSTRAINT invitation_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: password_credential password_credential_user_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.password_credential
    ADD CONSTRAINT password_credential_user_id_fkey FOREIGN KEY (user_id) REFERENCES iam."user"(id) ON DELETE CASCADE;


--
-- Name: password_reset_token password_reset_token_user_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.password_reset_token
    ADD CONSTRAINT password_reset_token_user_id_fkey FOREIGN KEY (user_id) REFERENCES iam."user"(id) ON DELETE CASCADE;


--
-- Name: role role_organization_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.role
    ADD CONSTRAINT role_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: session session_user_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.session
    ADD CONSTRAINT session_user_id_fkey FOREIGN KEY (user_id) REFERENCES iam."user"(id) ON DELETE CASCADE;


--
-- Name: sso_identity sso_identity_user_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.sso_identity
    ADD CONSTRAINT sso_identity_user_id_fkey FOREIGN KEY (user_id) REFERENCES iam."user"(id) ON DELETE CASCADE;


--
-- Name: user_preference user_preference_organization_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.user_preference
    ADD CONSTRAINT user_preference_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: active_connection active_connection_active_channel_fk; Type: FK CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.active_connection
    ADD CONSTRAINT active_connection_active_channel_fk FOREIGN KEY (organization_id, active_channel_id) REFERENCES chat.channel(organization_id, id) ON DELETE CASCADE;


--
-- Name: active_connection active_connection_organization_id_fkey; Type: FK CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.active_connection
    ADD CONSTRAINT active_connection_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: active_context active_context_organization_id_fkey; Type: FK CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.active_context
    ADD CONSTRAINT active_context_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: delivery_attempt delivery_attempt_organization_id_fkey; Type: FK CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.delivery_attempt
    ADD CONSTRAINT delivery_attempt_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: delivery_attempt delivery_attempt_recipient_fk; Type: FK CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.delivery_attempt
    ADD CONSTRAINT delivery_attempt_recipient_fk FOREIGN KEY (organization_id, notification_recipient_id) REFERENCES notification.notification_recipient(organization_id, id) ON DELETE CASCADE;


--
-- Name: ephemeral_signal ephemeral_signal_organization_id_fkey; Type: FK CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.ephemeral_signal
    ADD CONSTRAINT ephemeral_signal_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: active_connection fk_active_connection_employee; Type: FK CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.active_connection
    ADD CONSTRAINT fk_active_connection_employee FOREIGN KEY (organization_id, employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE;


--
-- Name: notification_delivery_log fk_delivery_log_recipient; Type: FK CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.notification_delivery_log
    ADD CONSTRAINT fk_delivery_log_recipient FOREIGN KEY (organization_id, notification_recipient_id) REFERENCES notification.notification_recipient(organization_id, id) ON DELETE CASCADE;


--
-- Name: ephemeral_signal fk_ephemeral_signal_channel; Type: FK CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.ephemeral_signal
    ADD CONSTRAINT fk_ephemeral_signal_channel FOREIGN KEY (organization_id, channel_id) REFERENCES chat.channel(organization_id, id) ON DELETE CASCADE;


--
-- Name: ephemeral_signal fk_ephemeral_signal_sender; Type: FK CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.ephemeral_signal
    ADD CONSTRAINT fk_ephemeral_signal_sender FOREIGN KEY (organization_id, sender_employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE RESTRICT;


--
-- Name: notification_recipient fk_notification_recipient_employee; Type: FK CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.notification_recipient
    ADD CONSTRAINT fk_notification_recipient_employee FOREIGN KEY (organization_id, employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE;


--
-- Name: notification_recipient fk_notification_recipient_notification; Type: FK CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.notification_recipient
    ADD CONSTRAINT fk_notification_recipient_notification FOREIGN KEY (organization_id, notification_id) REFERENCES notification.notification(organization_id, id) ON DELETE CASCADE;


--
-- Name: presence_visibility fk_presence_visibility_employee; Type: FK CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.presence_visibility
    ADD CONSTRAINT fk_presence_visibility_employee FOREIGN KEY (organization_id, employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE;


--
-- Name: push_token fk_push_token_employee; Type: FK CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.push_token
    ADD CONSTRAINT fk_push_token_employee FOREIGN KEY (organization_id, employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE;


--
-- Name: resource_subscription fk_resource_subscription_employee; Type: FK CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.resource_subscription
    ADD CONSTRAINT fk_resource_subscription_employee FOREIGN KEY (organization_id, employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE;


--
-- Name: resource_subscription_reason fk_resource_subscription_reason_subscription; Type: FK CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.resource_subscription_reason
    ADD CONSTRAINT fk_resource_subscription_reason_subscription FOREIGN KEY (organization_id, subscription_id) REFERENCES notification.resource_subscription(organization_id, id) ON DELETE CASCADE;


--
-- Name: live_receipt live_receipt_employee_fk; Type: FK CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.live_receipt
    ADD CONSTRAINT live_receipt_employee_fk FOREIGN KEY (organization_id, employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE;


--
-- Name: live_receipt live_receipt_organization_id_fkey; Type: FK CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.live_receipt
    ADD CONSTRAINT live_receipt_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: live_receipt live_receipt_recipient_fk; Type: FK CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.live_receipt
    ADD CONSTRAINT live_receipt_recipient_fk FOREIGN KEY (organization_id, notification_recipient_id) REFERENCES notification.notification_recipient(organization_id, id) ON DELETE CASCADE;


--
-- Name: notification_batch notification_batch_organization_id_fkey; Type: FK CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.notification_batch
    ADD CONSTRAINT notification_batch_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: notification_delivery_log notification_delivery_log_organization_id_fkey; Type: FK CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.notification_delivery_log
    ADD CONSTRAINT notification_delivery_log_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: notification notification_organization_id_fkey; Type: FK CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.notification
    ADD CONSTRAINT notification_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: notification_recipient notification_recipient_organization_id_fkey; Type: FK CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.notification_recipient
    ADD CONSTRAINT notification_recipient_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: personal_preference personal_preference_organization_id_employee_id_fkey; Type: FK CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.personal_preference
    ADD CONSTRAINT personal_preference_organization_id_employee_id_fkey FOREIGN KEY (organization_id, employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE;


--
-- Name: personal_preference personal_preference_organization_id_fkey; Type: FK CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.personal_preference
    ADD CONSTRAINT personal_preference_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: presence_visibility presence_visibility_organization_id_fkey; Type: FK CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.presence_visibility
    ADD CONSTRAINT presence_visibility_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: push_token push_token_organization_id_fkey; Type: FK CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.push_token
    ADD CONSTRAINT push_token_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id);


--
-- Name: resource_subscription resource_subscription_organization_id_fkey; Type: FK CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.resource_subscription
    ADD CONSTRAINT resource_subscription_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: resource_subscription_reason resource_subscription_reason_organization_id_fkey; Type: FK CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.resource_subscription_reason
    ADD CONSTRAINT resource_subscription_reason_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: resource_surface resource_surface_organization_id_fkey; Type: FK CONSTRAINT; Schema: notification; Owner: -
--

ALTER TABLE ONLY notification.resource_surface
    ADD CONSTRAINT resource_surface_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: department_member department_member_organization_id_fkey; Type: FK CONSTRAINT; Schema: organization; Owner: -
--

ALTER TABLE ONLY organization.department_member
    ADD CONSTRAINT department_member_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: department department_organization_id_fkey; Type: FK CONSTRAINT; Schema: organization; Owner: -
--

ALTER TABLE ONLY organization.department
    ADD CONSTRAINT department_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: employee employee_organization_id_fkey; Type: FK CONSTRAINT; Schema: organization; Owner: -
--

ALTER TABLE ONLY organization.employee
    ADD CONSTRAINT employee_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: department_member fk_department_member_department; Type: FK CONSTRAINT; Schema: organization; Owner: -
--

ALTER TABLE ONLY organization.department_member
    ADD CONSTRAINT fk_department_member_department FOREIGN KEY (organization_id, department_id) REFERENCES organization.department(organization_id, id) ON DELETE CASCADE;


--
-- Name: department_member fk_department_member_employee; Type: FK CONSTRAINT; Schema: organization; Owner: -
--

ALTER TABLE ONLY organization.department_member
    ADD CONSTRAINT fk_department_member_employee FOREIGN KEY (organization_id, employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE CASCADE;


--
-- Name: department fk_department_parent; Type: FK CONSTRAINT; Schema: organization; Owner: -
--

ALTER TABLE ONLY organization.department
    ADD CONSTRAINT fk_department_parent FOREIGN KEY (organization_id, parent_department_id) REFERENCES organization.department(organization_id, id) ON DELETE RESTRICT;


--
-- Name: default_role_permission default_role_permission_permission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.default_role_permission
    ADD CONSTRAINT default_role_permission_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES public.permission(id) ON DELETE CASCADE;


--
-- Name: default_role_permission default_role_permission_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.default_role_permission
    ADD CONSTRAINT default_role_permission_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.default_role(id) ON DELETE CASCADE;


--
-- Name: call_artifact call_artifact_organization_id_fkey; Type: FK CONSTRAINT; Schema: voice; Owner: -
--

ALTER TABLE ONLY voice.call_artifact
    ADD CONSTRAINT call_artifact_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: call_invitation call_invitation_organization_id_fkey; Type: FK CONSTRAINT; Schema: voice; Owner: -
--

ALTER TABLE ONLY voice.call_invitation
    ADD CONSTRAINT call_invitation_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: call_participant call_participant_organization_id_fkey; Type: FK CONSTRAINT; Schema: voice; Owner: -
--

ALTER TABLE ONLY voice.call_participant
    ADD CONSTRAINT call_participant_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: call_session call_session_organization_id_fkey; Type: FK CONSTRAINT; Schema: voice; Owner: -
--

ALTER TABLE ONLY voice.call_session
    ADD CONSTRAINT call_session_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- Name: call_artifact fk_voice_artifact_call; Type: FK CONSTRAINT; Schema: voice; Owner: -
--

ALTER TABLE ONLY voice.call_artifact
    ADD CONSTRAINT fk_voice_artifact_call FOREIGN KEY (organization_id, call_session_id) REFERENCES voice.call_session(organization_id, id) ON DELETE CASCADE;


--
-- Name: call_artifact fk_voice_artifact_file; Type: FK CONSTRAINT; Schema: voice; Owner: -
--

ALTER TABLE ONLY voice.call_artifact
    ADD CONSTRAINT fk_voice_artifact_file FOREIGN KEY (organization_id, file_id) REFERENCES files.file_metadata(organization_id, id) ON DELETE RESTRICT;


--
-- Name: call_session fk_voice_call_channel; Type: FK CONSTRAINT; Schema: voice; Owner: -
--

ALTER TABLE ONLY voice.call_session
    ADD CONSTRAINT fk_voice_call_channel FOREIGN KEY (organization_id, channel_id) REFERENCES chat.channel(organization_id, id) ON DELETE CASCADE;


--
-- Name: call_session fk_voice_call_ended_by; Type: FK CONSTRAINT; Schema: voice; Owner: -
--

ALTER TABLE ONLY voice.call_session
    ADD CONSTRAINT fk_voice_call_ended_by FOREIGN KEY (organization_id, ended_by_employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE RESTRICT;


--
-- Name: call_session fk_voice_call_initiator; Type: FK CONSTRAINT; Schema: voice; Owner: -
--

ALTER TABLE ONLY voice.call_session
    ADD CONSTRAINT fk_voice_call_initiator FOREIGN KEY (organization_id, initiator_employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE RESTRICT;


--
-- Name: call_invitation fk_voice_invitation_call; Type: FK CONSTRAINT; Schema: voice; Owner: -
--

ALTER TABLE ONLY voice.call_invitation
    ADD CONSTRAINT fk_voice_invitation_call FOREIGN KEY (organization_id, call_session_id) REFERENCES voice.call_session(organization_id, id) ON DELETE CASCADE;


--
-- Name: call_invitation fk_voice_invitation_invitee; Type: FK CONSTRAINT; Schema: voice; Owner: -
--

ALTER TABLE ONLY voice.call_invitation
    ADD CONSTRAINT fk_voice_invitation_invitee FOREIGN KEY (organization_id, invitee_employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE RESTRICT;


--
-- Name: call_invitation fk_voice_invitation_inviter; Type: FK CONSTRAINT; Schema: voice; Owner: -
--

ALTER TABLE ONLY voice.call_invitation
    ADD CONSTRAINT fk_voice_invitation_inviter FOREIGN KEY (organization_id, inviter_employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE RESTRICT;


--
-- Name: call_invitation fk_voice_invitation_notification; Type: FK CONSTRAINT; Schema: voice; Owner: -
--

ALTER TABLE ONLY voice.call_invitation
    ADD CONSTRAINT fk_voice_invitation_notification FOREIGN KEY (organization_id, notification_id) REFERENCES notification.notification(organization_id, id) ON DELETE RESTRICT;


--
-- Name: voice_message fk_voice_message_channel; Type: FK CONSTRAINT; Schema: voice; Owner: -
--

ALTER TABLE ONLY voice.voice_message
    ADD CONSTRAINT fk_voice_message_channel FOREIGN KEY (organization_id, channel_id) REFERENCES chat.channel(organization_id, id) ON DELETE CASCADE;


--
-- Name: voice_message fk_voice_message_file; Type: FK CONSTRAINT; Schema: voice; Owner: -
--

ALTER TABLE ONLY voice.voice_message
    ADD CONSTRAINT fk_voice_message_file FOREIGN KEY (organization_id, file_id) REFERENCES files.file_metadata(organization_id, id) ON DELETE RESTRICT;


--
-- Name: voice_message fk_voice_message_message; Type: FK CONSTRAINT; Schema: voice; Owner: -
--

ALTER TABLE ONLY voice.voice_message
    ADD CONSTRAINT fk_voice_message_message FOREIGN KEY (organization_id, message_id) REFERENCES chat.message(organization_id, id) ON DELETE RESTRICT;


--
-- Name: voice_message fk_voice_message_sender; Type: FK CONSTRAINT; Schema: voice; Owner: -
--

ALTER TABLE ONLY voice.voice_message
    ADD CONSTRAINT fk_voice_message_sender FOREIGN KEY (organization_id, sender_employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE RESTRICT;


--
-- Name: call_participant fk_voice_participant_call; Type: FK CONSTRAINT; Schema: voice; Owner: -
--

ALTER TABLE ONLY voice.call_participant
    ADD CONSTRAINT fk_voice_participant_call FOREIGN KEY (organization_id, call_session_id) REFERENCES voice.call_session(organization_id, id) ON DELETE CASCADE;


--
-- Name: call_participant fk_voice_participant_employee; Type: FK CONSTRAINT; Schema: voice; Owner: -
--

ALTER TABLE ONLY voice.call_participant
    ADD CONSTRAINT fk_voice_participant_employee FOREIGN KEY (organization_id, employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE RESTRICT;


--
-- Name: call_participant fk_voice_participant_inviter; Type: FK CONSTRAINT; Schema: voice; Owner: -
--

ALTER TABLE ONLY voice.call_participant
    ADD CONSTRAINT fk_voice_participant_inviter FOREIGN KEY (organization_id, invited_by_employee_id) REFERENCES organization.employee(organization_id, id) ON DELETE RESTRICT;


--
-- Name: voice_message voice_message_organization_id_fkey; Type: FK CONSTRAINT; Schema: voice; Owner: -
--

ALTER TABLE ONLY voice.voice_message
    ADD CONSTRAINT voice_message_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organization(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


