-- Parker Database Schema
-- Run against PostgreSQL to initialize the database

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Fast plate lookups (mirrors on-chain DriverRegistry)
CREATE TABLE drivers (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet        VARCHAR(42) NOT NULL,
    plate_number  VARCHAR(20) NOT NULL UNIQUE,
    country_code  VARCHAR(2) NOT NULL,
    car_make      VARCHAR(50),
    car_model     VARCHAR(50),
    active        BOOLEAN DEFAULT true,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_drivers_wallet ON drivers(wallet);
CREATE INDEX idx_drivers_plate ON drivers(plate_number);

-- Session index (mirrors on-chain ParkingNFT)
CREATE TABLE sessions (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    token_id      BIGINT UNIQUE,
    plate_number  VARCHAR(20) NOT NULL,
    lot_id        VARCHAR(50) NOT NULL,
    entry_time    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    exit_time     TIMESTAMPTZ,
    fee_amount    DECIMAL(10, 6),
    fee_currency  VARCHAR(10),
    stripe_payment_id VARCHAR(255),
    tx_hash       VARCHAR(66),
    status        VARCHAR(20) DEFAULT 'active',
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sessions_plate ON sessions(plate_number);
CREATE INDEX idx_sessions_lot ON sessions(lot_id);
CREATE INDEX idx_sessions_status ON sessions(status);

-- Prevent duplicate active sessions for the same plate (race-condition guard)
CREATE UNIQUE INDEX idx_sessions_one_active_per_plate
  ON sessions(plate_number) WHERE status = 'active';

-- Enforce valid session statuses
ALTER TABLE sessions ADD CONSTRAINT chk_session_status
  CHECK (status IN ('active', 'completed', 'cancelled'));

-- Parking lot configuration
CREATE TABLE lots (
    id              VARCHAR(50) PRIMARY KEY,
    name            VARCHAR(100) NOT NULL,
    address         TEXT,
    lat             DECIMAL(10, 7),
    lng             DECIMAL(10, 7),
    capacity        INT,
    rate_per_hour   DECIMAL(10, 2) NOT NULL,
    billing_minutes INT DEFAULT 15,
    max_daily_fee   DECIMAL(10, 2),
    grace_period_minutes DECIMAL(10, 2) DEFAULT 0.5,
    currency        VARCHAR(10) NOT NULL DEFAULT 'USD',
    payment_methods TEXT[] DEFAULT '{stripe,x402}',
    operator_wallet VARCHAR(42) NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Idempotency keys for gate entry/exit requests
-- Prevents duplicate side effects (double mint/burn/session transitions) on retries.
CREATE TABLE idempotency_keys (
    endpoint        VARCHAR(64) NOT NULL,    -- e.g. gate:entry, gate:exit
    idempotency_key VARCHAR(255) NOT NULL,
    request_hash    VARCHAR(128) NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending|completed
    response_code   INT,
    response_body   JSONB,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,
    PRIMARY KEY (endpoint, idempotency_key),
    CONSTRAINT chk_idempotency_status CHECK (status IN ('pending', 'completed'))
);

-- Persistent XRPL/Xaman payment intents (survive API restarts)
CREATE TABLE xrpl_payment_intents (
    payment_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    plate_number    VARCHAR(20) NOT NULL,
    lot_id          VARCHAR(50) NOT NULL,
    session_id      VARCHAR(64) NOT NULL,
    amount          DECIMAL(20, 6) NOT NULL,
    destination     VARCHAR(128) NOT NULL,
    token           VARCHAR(32) NOT NULL,
    network         VARCHAR(32) NOT NULL,
    xaman_payload_uuid UUID,
    xaman_deep_link TEXT,
    xaman_qr_png    TEXT,
    tx_hash         VARCHAR(128),
    status          VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending|resolved|expired|cancelled
    expires_at      TIMESTAMPTZ NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT chk_xrpl_intent_status CHECK (status IN ('pending', 'resolved', 'expired', 'cancelled'))
);

CREATE INDEX idx_xrpl_intents_plate_lot ON xrpl_payment_intents(plate_number, lot_id);
CREATE INDEX idx_xrpl_intents_expires_at ON xrpl_payment_intents(expires_at);
CREATE INDEX idx_xrpl_intents_payload_uuid ON xrpl_payment_intents(xaman_payload_uuid);

-- One active pending intent per plate+lot at a time.
CREATE UNIQUE INDEX idx_xrpl_intents_one_pending_per_plate_lot
  ON xrpl_payment_intents(plate_number, lot_id)
  WHERE status = 'pending';
