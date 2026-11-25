-- Admin console dev seed (OCR draft + open issue + sync run)
INSERT OR IGNORE INTO ocr_image_jobs (id, show_id, source_channel, source_page_url, image_url, image_hash, ocr_status, extracted_json, confidence)
VALUES
  (1, 1, 'NOL티켓', 'https://tickets.interpark.com/example/aladdin-notice', 'https://tickets.interpark.com/example/notice-curtain.jpg', 'hash-demo-001', 'DONE', '{"hasRelevantInfo":true,"confidence":0.94,"events":[{"dealType":"CURTAIN_CALL","eventDates":["2026-11-29"],"perkSummary":"커튼콜 촬영 허용 (플래시 금지)"}]}', 0.94);

INSERT OR IGNORE INTO deals (
  show_id, channel_name, deal_type, seat_grade, is_unconditional,
  condition_summary, event_dates_json, perk_summary, external_url, external_key,
  status, source_type, source_ocr_job_id
)
VALUES
  (1, 'NOL티켓', 'CURTAIN_CALL', 'ALL', 1, '11.29(일) 19:00 회차 커튼콜 촬영 가능 (플래시 금지)', '["2026-11-29"]', '커튼콜 촬영 허용', 'https://tickets.interpark.com/example/aladdin-notice', 'seed-draft-ocr-1', 'DRAFT', 'OCR_APPROVED', 1);

INSERT OR IGNORE INTO deal_issues (id, deal_id, reporter_id, issue_type, note, status)
VALUES
  (1, (SELECT id FROM deals WHERE external_key = 'seed-dracula-link'), 2, 'PRICE_MISMATCH', '현재 티켓링크에서 R석 35% 할인이 조기 종료되어 25%만 적용됩니다.', 'OPEN');

INSERT OR IGNORE INTO sync_runs (id, source_name, status, fetched_count, draft_count, finished_at)
VALUES
  (1, 'KOPIS', 'SUCCESS', 6, 0, '2026-11-25T01:00:00.000Z');
