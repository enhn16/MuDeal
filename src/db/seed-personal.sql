-- Personalization seed data for dev user #2 (대학로산책)
INSERT OR IGNORE INTO user_show_bookmarks (id, user_id, show_id)
VALUES
  (1, 2, 1),
  (2, 2, 2),
  (3, 2, 3);

INSERT OR IGNORE INTO user_actor_follows (id, user_id, actor_id)
VALUES
  (1, 2, 1),
  (2, 2, 4);

INSERT OR IGNORE INTO user_notifications (id, user_id, noti_type, show_id, deal_id, actor_id, title, body, is_read, is_saved, dedup_key)
VALUES
  (1, 2, 'BOOKMARKED_SHOW_DEAL', 1, (SELECT id FROM deals WHERE external_key = 'seed-aladdin-lottery'), NULL, '뮤지컬 <알라딘> NOL 로터리 73% 오픈', 'VIP석 50,000원 추첨 응모가 진행 중입니다.', 0, 0, 'seed-noti-1'),
  (2, 2, 'FOLLOWED_ACTOR_DEAL', 4, (SELECT id FROM deals WHERE external_key = 'seed-dracula-singalong'), 1, '김준수 출연 <드라큘라> 싱어롱 데이', '12월 12일 회차 기념 스페셜 티켓 전원 증정', 0, 1, 'seed-noti-2'),
  (3, 2, 'BOOKMARKED_SHOW_DEAL', 3, (SELECT id FROM deals WHERE external_key = 'seed-happyending-open'), NULL, '뮤지컬 <어쩌면 해피엔딩> 3차 티켓오픈', '11월 28일 14:00 YES24티켓 오픈 예정', 0, 0, 'seed-noti-3'),
  (4, 2, 'FOLLOWED_ACTOR_NEW_SHOW', 6, NULL, 4, '박은태 출연 <여신님이 보고 계셔> 등록', '예스24스테이지 1관 12월 개막 예정', 1, 0, 'seed-noti-4');

INSERT OR IGNORE INTO user_calendar_events (id, user_id, event_date, event_time, category, title, memo, source_show_id, source_deal_id)
VALUES
  (1, 2, '2026-11-25', '19:30', 'WATCH', '뮤지컬 <빨래> 관극', '대학로 유니플렉스 · R석', 2, NULL),
  (2, 2, '2026-11-28', '14:00', 'TICKETING', '<어쩌면 해피엔딩> 3차 티켓팅', 'YES24 로그인 미리 해두기', 3, (SELECT id FROM deals WHERE external_key = 'seed-happyending-open'));

INSERT OR IGNORE INTO user_search_presets (id, user_id, name, query_params_json)
VALUES
  (1, 2, '대학로 5만원 이하', '{"region":"DAEHAKRO","priceMax":50000}');

INSERT OR IGNORE INTO deal_reports (id, reporter_id, reporter_nickname, show_id, reported_show_title, channel_name, external_url, deal_type, seat_grade, reported_price, reported_discount_rate, is_unconditional, condition_note, status)
VALUES
  (1, 2, '대학로산책', 2, '뮤지컬 <빨래> 20주년', '엘티켓', 'https://www.l-ticket.co.kr/example/laundry', 'TIMESALE', 'R', 38500, 45, 1, '평일 낮 마티네 무조건 할인', 'APPROVED'),
  (2, 2, '대학로산책', 4, '뮤지컬 <드라큘라> 10주년', 'NOL티켓', 'https://tickets.interpark.com/example/dracula-curtain', 'CURTAIN_CALL', 'ALL', NULL, NULL, 1, '주말 커튼콜 데이 공지', 'PENDING');

UPDATE deals SET source_report_id = 1 WHERE external_key = 'seed-laundry-lticket' AND source_report_id IS NULL;
