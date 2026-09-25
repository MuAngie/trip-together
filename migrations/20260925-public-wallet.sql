-- Existing trip only: add the confirmed JPY contributions once.
-- This single statement is atomic. The marker prevents deleted/edited contributions
-- from being recreated on a later run. Existing records are never overwritten.
INSERT INTO runtime_records (trip_id, collection, record_id, value, updated_at)
SELECT 'shanghai-japan-2026', 'walletEntries', json_extract(value, '$.id'), value, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM json_each('[
  {"id":"wallet-initialized-v1","kind":"initialization"},
  {"id":"wallet-opening-chen-feng","kind":"contribution","currency":"JPY","amountYen":200000,"familyId":"chen-feng","category":"","note":"首笔公共资金缴款（已收齐）","date":""},
  {"id":"wallet-opening-yu-jin","kind":"contribution","currency":"JPY","amountYen":200000,"familyId":"yu-jin","category":"","note":"首笔公共资金缴款（已收齐）","date":""},
  {"id":"wallet-opening-huang-xian","kind":"contribution","currency":"JPY","amountYen":200000,"familyId":"huang-xian","category":"","note":"首笔公共资金缴款（已收齐）","date":""}
]')
WHERE NOT EXISTS (
  SELECT 1 FROM runtime_records
  WHERE trip_id = 'shanghai-japan-2026' AND collection = 'walletEntries' AND record_id = 'wallet-initialized-v1'
)
ON CONFLICT (trip_id, collection, record_id) DO NOTHING;
