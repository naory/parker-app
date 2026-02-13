-- Parker Database Seed Data
-- Inserts demo lot(s) and optionally a test driver for local development.

-- Demo parking lot: "Parker HQ" in Tel Aviv
INSERT INTO lots (id, name, address, lat, lng, capacity, rate_per_hour, billing_minutes, max_daily_fee, operator_wallet)
VALUES (
    'lot-01',
    'Parker HQ',
    '123 Rothschild Blvd, Tel Aviv',
    32.0636130,
    34.7746300,
    50,
    3.30,
    15,
    25.00,
    '0x0000000000000000000000000000000000000001'
)
ON CONFLICT (id) DO NOTHING;

-- Second demo lot: "Azrieli Center"
INSERT INTO lots (id, name, address, lat, lng, capacity, rate_per_hour, billing_minutes, max_daily_fee, operator_wallet)
VALUES (
    'lot-02',
    'Azrieli Center',
    '132 Menachem Begin Rd, Tel Aviv',
    32.0741940,
    34.7917780,
    200,
    5.00,
    15,
    35.00,
    '0x0000000000000000000000000000000000000001'
)
ON CONFLICT (id) DO NOTHING;

-- Optional: test driver for development (comment out in production)
INSERT INTO drivers (wallet, plate_number, country_code, car_make, car_model)
VALUES (
    '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    '12-345-67',
    'IL',
    'Toyota',
    'Corolla'
)
ON CONFLICT (plate_number) DO NOTHING;
