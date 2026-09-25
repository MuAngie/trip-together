-- Existing shared trip only: add the CNY 400 charter deposit once.
-- The marker keeps a later rerun from restoring a deleted or edited bill.
INSERT INTO runtime_records (trip_id, collection, record_id, value, updated_at)
SELECT 'shanghai-japan-2026',
       json_extract(item.value, '$.collection'),
       json_extract(item.value, '$.id'),
       json_extract(item.value, '$.payload'),
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM json_each('[
  {"collection":"migrations","id":"charter-car-deposit-2026","payload":{"id":"charter-car-deposit-2026","kind":"seed-marker"}},
  {"collection":"bills","id":"charter-car-deposit-2026","payload":{"id":"charter-car-deposit-2026","originalAmountCents":40000,"baseAmountCents":40000,"currency":"CNY","category":"交通","note":"10月8日京都周边、10月10日京都经神户到大阪两天包车定金。总价¥3,900（报价¥90,000日元，按当时报价折合约¥3,930后优惠）；已付¥400，尾款¥3,500待最后结算。每天10小时，阿尔法和海狮各一天。","orderedAt":"","payerId":"chen-feng","participantIds":["chen-feng","yu-jin","huang-xian"],"createdAt":"2026-09-25T00:00:00+08:00","updatedAt":"2026-09-25T00:00:00+08:00"}}
]') AS item
WHERE NOT EXISTS (
  SELECT 1 FROM runtime_records
  WHERE trip_id = 'shanghai-japan-2026'
    AND collection = 'migrations'
    AND record_id = 'charter-car-deposit-2026'
)
ON CONFLICT (trip_id, collection, record_id) DO NOTHING;
