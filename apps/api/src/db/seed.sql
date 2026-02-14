-- Parker Database Seed Data
-- Inserts demo lot(s) and optionally a test driver for local development.
-- Demo lots use ILS (Israeli Shekel) since they're in Tel Aviv — currency is per-lot config.

-- Demo parking lot: "Parker HQ" in Tel Aviv (ILS)
INSERT INTO lots (id, name, address, lat, lng, capacity, rate_per_hour, billing_minutes, max_daily_fee, currency, payment_methods, operator_wallet)
VALUES (
    'lot-01',
    'Parker HQ',
    '123 Rothschild Blvd, Tel Aviv',
    32.0636130,
    34.7746300,
    50,
    12.00,
    15,
    90.00,
    'ILS',
    '{stripe,x402}',
    '0x0000000000000000000000000000000000000001'
)
ON CONFLICT (id) DO NOTHING;

-- Second demo lot: "Azrieli Center" in Tel Aviv (ILS)
INSERT INTO lots (id, name, address, lat, lng, capacity, rate_per_hour, billing_minutes, max_daily_fee, currency, payment_methods, operator_wallet)
VALUES (
    'lot-02',
    'Azrieli Center',
    '132 Menachem Begin Rd, Tel Aviv',
    32.0741940,
    34.7917780,
    200,
    18.00,
    15,
    130.00,
    'ILS',
    '{stripe,x402}',
    '0x0000000000000000000000000000000000000001'
)
ON CONFLICT (id) DO NOTHING;

-- Optional: test driver for development (comment out in production)
INSERT INTO drivers (wallet, plate_number, country_code, car_make, car_model)
VALUES (
    '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    '1234567',
    'IL',
    'Toyota',
    'Corolla'
)
ON CONFLICT (plate_number) DO NOTHING;
