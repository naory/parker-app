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
    fee_usdc      DECIMAL(10, 6),
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
    operator_wallet VARCHAR(42) NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
