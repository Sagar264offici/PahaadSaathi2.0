-- ============================================================
-- PAHAADSAATHI — MQTT NETWORK CORE DATABASE SCHEMA
-- Migration: 20261122110000_mqtt_network_core.sql
-- Supports idempotency tracking, outbox queuing, and event acknowledgement
-- ============================================================

-- 1. MQTT Message Idempotency Log
-- Prevents duplicate database inserts from at-least-once MQTT QoS 1 delivery
CREATE TABLE IF NOT EXISTS public.mqtt_idempotency_log (
  event_id UUID PRIMARY KEY,
  correlation_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  producer_device_id TEXT NOT NULL,
  producer_user_id TEXT,
  status TEXT NOT NULL DEFAULT 'persisted' CHECK (status IN ('persisted', 'duplicate', 'rejected')),
  hazard_id UUID REFERENCES public.hazards(id) ON DELETE SET NULL,
  payload_hash TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  processed_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_mqtt_idempotency_correlation
  ON public.mqtt_idempotency_log(correlation_id);

CREATE INDEX IF NOT EXISTS idx_mqtt_idempotency_user
  ON public.mqtt_idempotency_log(producer_user_id);

-- Enable Row Level Security
ALTER TABLE public.mqtt_idempotency_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages idempotency log" ON public.mqtt_idempotency_log;
CREATE POLICY "Service role manages idempotency log"
  ON public.mqtt_idempotency_log FOR ALL USING (true);

DROP POLICY IF EXISTS "Users can read own idempotency logs" ON public.mqtt_idempotency_log;
CREATE POLICY "Users can read own idempotency logs"
  ON public.mqtt_idempotency_log FOR SELECT USING (
    producer_user_id = auth.uid()::text
  );

-- 2. Transactional Outbox for Backend-Driven Publishing
CREATE TABLE IF NOT EXISTS public.mqtt_outbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_id UUID NOT NULL,
  correlation_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  priority TEXT NOT NULL DEFAULT 'P2' CHECK (priority IN ('P0', 'P1', 'P2', 'P3', 'P4')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (
    status IN ('queued', 'publishing', 'published', 'failed')
  ),
  retry_count INT NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  published_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mqtt_outbox_status_prio
  ON public.mqtt_outbox(status, priority, created_at);

ALTER TABLE public.mqtt_outbox ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages outbox" ON public.mqtt_outbox;
CREATE POLICY "Service role manages outbox"
  ON public.mqtt_outbox FOR ALL USING (true);
