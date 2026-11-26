-- Dev seed data for local D1 (safe to re-run; lives outside migrations/)
INSERT OR IGNORE INTO users (id, oauth_provider, oauth_subject, nickname, email, role, status, terms_agreed_at)
VALUES
  (1, 'GOOGLE', 'dev-admin-001', 'MuDeal운영', 'admin@mudeal.local', 'ADMIN', 'ACTIVE', '2026-11-25T00:00:00.000Z'),
  (2, 'KAKAO', 'dev-user-001', '대학로산책', 'walker@mudeal.local', 'USER', 'ACTIVE', '2026-11-25T00:00:00.000Z'),
  (3, 'KAKAO', 'dev-user-002', '뮤덕10년차', 'fan10@mudeal.local', 'USER', 'ACTIVE', '2026-11-25T00:00:00.000Z');

INSERT OR IGNORE INTO shows (id, kopis_id, title, normalized_title, poster_url, venue_name, venue_address, region, sub_region, start_date, end_date, base_prices_json, min_active_price, max_discount_rate, status, view_count)
VALUES
  (1, 'PF200001', '뮤지컬 <알라딘> 한국 초연', '뮤지컬알라딘한국초연', NULL, '샤롯데씨어터', '서울특별시 송파구 올림픽로 240', '서울', 'SEOUL_OTHER', '2026-11-01', '2027-03-31', '{"VIP":190000,"R":160000,"S":130000,"A":90000}', 50000, 73, 'ONGOING', 1420),
  (2, 'PF200002', '뮤지컬 <빨래> 20주년', '뮤지컬빨래20주년', NULL, '인터파크 유니플렉스 2관', '서울특별시 종로구 대학로12길 64', '서울', 'DAEHAKRO', '2026-11-01', '2027-02-28', '{"R":70000,"S":55000}', 38500, 45, 'ONGOING', 890),
  (3, 'PF200003', '뮤지컬 <어쩌면 해피엔딩>', '뮤지컬어쩌면해피엔딩', NULL, '예스24스테이지 1관', '서울특별시 종로구 대학로12길 21', '서울', 'DAEHAKRO', '2026-11-15', '2027-01-31', '{"R":66000,"S":44000}', 39600, 40, 'ONGOING', 760),
  (4, 'PF200004', '뮤지컬 <드라큘라> 10주년', '뮤지컬드라큘라10주년', NULL, '블루스퀘어 신한카드홀', '서울특별시 용산구 이태원로 294', '서울', 'SEOUL_OTHER', '2026-11-10', '2027-02-15', '{"VIP":170000,"R":140000,"S":110000,"A":80000}', 78000, 35, 'ONGOING', 1120),
  (5, 'PF200005', '오페라의 유령 부산 투어', '오페라의유령부산투어', NULL, '드림씨어터', '부산광역시 남구 전포대로 133', '부산', 'BUSAN', '2026-11-20', '2027-01-25', '{"VIP":180000,"R":150000,"S":120000,"A":90000}', 84000, 30, 'ONGOING', 640),
  (6, 'PF200006', '뮤지컬 <여신님이 보고 계셔>', '뮤지컬여신님이보고계셔', NULL, '예스24스테이지 1관', '서울특별시 종로구 대학로12길 21', '서울', 'DAEHAKRO', '2026-12-05', '2027-03-01', '{"R":66000,"S":44000}', NULL, NULL, 'UPCOMING', 310);

INSERT OR IGNORE INTO actors (id, name, normalized_name, follower_count)
VALUES
  (1, '김준수', '김준수', 1240),
  (2, '홍광호', '홍광호', 980),
  (3, '전미도', '전미도', 860),
  (4, '박은태', '박은태', 790),
  (5, '정성화', '정성화', 650);

INSERT OR IGNORE INTO show_actors (id, show_id, actor_id, role_name, source_type)
VALUES
  (1, 1, 1, '알라딘', 'KOPIS'),
  (2, 1, 5, '지니', 'KOPIS'),
  (3, 3, 3, '클레어', 'KOPIS'),
  (4, 4, 1, '드라큘라', 'KOPIS'),
  (5, 4, 4, '드라큘라', 'KOPIS'),
  (6, 5, 2, '오페라의 유령', 'KOPIS'),
  (7, 6, 4, '한영범', 'KOPIS');

INSERT OR IGNORE INTO deals (
  id, show_id, channel_name, deal_type, seat_grade, base_price, sale_price, discount_rate,
  is_unconditional, condition_tags_json, condition_summary, opens_at, event_dates_json,
  perk_summary, fee_info, external_url, external_key, expires_at, status, source_type,
  reporter_nickname, click_count, helpful_count
)
VALUES
  (1, 1, 'NOL티켓', 'LOTTERY', 'VIP', 190000, 50000, 73, 0, NULL, '매일 오전 11시 로터리 추첨 응모 (1인 2매)', NULL, NULL, NULL, '예매수수료 2,000원', 'https://tickets.interpark.com/example/aladdin-lottery', 'seed-aladdin-lottery', '2026-12-31T14:59:59.000Z', 'ACTIVE', 'SYNC_APPROVED', NULL, 342, 41),
  (2, 1, '유니켓', 'TIMESALE', 'VIP', 190000, 123500, 35, 1, '["MATINEE"]', '평일 마티네 전석 무조건 할인', NULL, NULL, NULL, '예매수수료 1,000원', 'https://www.uniket.co.kr/example/aladdin-vip', 'seed-aladdin-uniket', '2026-11-30T14:59:59.000Z', 'ACTIVE', 'SYNC_APPROVED', NULL, 196, 18),
  (3, 1, 'YES24티켓', 'DISCOUNT_SITE', 'R', 160000, 112000, 30, 0, '["REWATCH"]', '재관람 유료 티켓 지참 시 30%', NULL, NULL, NULL, '예매수수료 2,000원', 'https://ticket.yes24.com/example/aladdin-rewatch', 'seed-aladdin-yes24', '2026-12-10T14:59:59.000Z', 'ACTIVE', 'USER_REPORT', '뮤덕10년차', 128, 24),
  (4, 1, '샤롯데씨어터', 'CURTAIN_CALL', 'ALL', NULL, NULL, NULL, 1, NULL, '주말 전 회차 커튼콜 촬영 가능', NULL, '["2026-12-05","2026-12-06"]', '스페셜 포토카드 1종 증정', NULL, 'https://www.charlottetheater.co.kr/example/curtaincall', 'seed-aladdin-curtain', '2026-12-06T14:59:59.000Z', 'ACTIVE', 'OCR_APPROVED', NULL, 89, 19),
  (5, 2, '엘티켓', 'TIMESALE', 'R', 70000, 38500, 45, 1, '["MATINEE"]', '평일 낮 마티네 무조건 할인', NULL, NULL, NULL, '예매수수료 1,000원', 'https://www.l-ticket.co.kr/example/laundry', 'seed-laundry-lticket', '2026-11-29T14:59:59.000Z', 'ACTIVE', 'USER_REPORT', '대학로산책', 164, 31),
  (6, 2, '티켓링크', 'DISCOUNT_SITE', 'S', 55000, 35750, 35, 0, '["YOUTH_STUDENT"]', '청년·대학생 증빙 시 할인', NULL, NULL, NULL, '예매수수료 1,000원', 'https://www.ticketlink.co.kr/example/laundry-youth', 'seed-laundry-youth', '2026-12-20T14:59:59.000Z', 'ACTIVE', 'SYNC_APPROVED', NULL, 74, 9),
  (7, 3, 'YES24티켓', 'TIMESALE', 'R', 66000, 39600, 40, 1, '["OFFICE_WORKER"]', 'YES24데이 평일 저녁 특가', NULL, NULL, NULL, '예매수수료 2,000원', 'https://ticket.yes24.com/example/happyending-sale', 'seed-happyending-sale', '2026-11-28T14:59:59.000Z', 'ACTIVE', 'SYNC_APPROVED', NULL, 118, 15),
  (9, 4, '티켓링크', 'SPECIAL_DAY', 'S', 110000, 78000, 29, 1, '["CARD_PARTNER"]', '블루스퀘어 제휴 특가 (전석 오픈)', NULL, NULL, NULL, '예매수수료 2,000원', 'https://www.ticketlink.co.kr/example/dracula', 'seed-dracula-link', '2026-11-27T14:59:59.000Z', 'ACTIVE', 'USER_REPORT', '뮤덕10년차', 211, 29),
  (10, 4, 'NOL티켓', 'SINGALONG', 'ALL', NULL, NULL, NULL, 1, NULL, '10주년 기념 싱어롱 데이', NULL, '["2026-12-12"]', '기념 스페셜 티켓 전원 증정', NULL, 'https://tickets.interpark.com/example/dracula-singalong', 'seed-dracula-singalong', '2026-12-12T14:59:59.000Z', 'ACTIVE', 'OCR_APPROVED', NULL, 95, 22),
  (11, 5, 'NOL티켓', 'DISCOUNT_SITE', 'S', 120000, 84000, 30, 0, '["MATINEE"]', '부산 드림씨어터 평일 마티네 30%', NULL, NULL, NULL, '예매수수료 2,000원', 'https://tickets.interpark.com/example/phantom-busan', 'seed-phantom-busan', '2026-12-05T14:59:59.000Z', 'ACTIVE', 'SYNC_APPROVED', NULL, 82, 11);

INSERT OR IGNORE INTO deals (
  show_id, channel_name, deal_type, seat_grade, base_price, sale_price, discount_rate,
  is_unconditional, condition_tags_json, condition_summary, opens_at, event_dates_json,
  perk_summary, fee_info, external_url, external_key, expires_at, status, source_type,
  reporter_nickname, click_count, helpful_count
)
VALUES
  (3, '예스24스테이지', 'PERK_GOODS', 'ALL', NULL, NULL, NULL, 1, NULL, '전 유료 예매자 현장 특전 증정', NULL, '["2026-12-01","2026-12-15"]', '미공개 OST 엽서 세트 + 렌티큘러 포토카드 증정', NULL, 'https://ticket.yes24.com/example/happyending-perk', 'seed-happyending-perk', '2026-12-15T14:59:59.000Z', 'ACTIVE', 'OCR_APPROVED', NULL, 112, 27),
  (2, '인터파크 유니플렉스', 'PERK_GOODS', 'ALL', NULL, NULL, NULL, 1, NULL, '20주년 기념 회차 굿즈 특전', NULL, '["2026-12-04","2026-12-18"]', '20주년 한정판 스페셜 티켓 + 금속 뱃지 증정', NULL, 'https://tickets.interpark.com/example/laundry-perk', 'seed-laundry-perk', '2026-12-18T14:59:59.000Z', 'ACTIVE', 'SYNC_APPROVED', NULL, 94, 21),
  (2, '인터파크 유니플렉스', 'CURTAIN_CALL', 'ALL', NULL, NULL, NULL, 1, NULL, '20주년 스페셜 커튼콜 데이 (전 회차 촬영 가능)', NULL, '["2026-12-06","2026-12-13"]', '커튼콜 데이 스페셜 엽서 증정', NULL, 'https://tickets.interpark.com/example/laundry-curtain', 'seed-laundry-curtain', '2026-12-13T14:59:59.000Z', 'ACTIVE', 'OCR_APPROVED', NULL, 108, 25);

INSERT OR IGNORE INTO home_curations (id, slot_type, show_id, eyebrow, title, subtitle, link_url, sort_order, is_active)
VALUES
  (1, 'HERO', 1, 'WEEKEND TIMEDEAL', '대극장 VIP석 최대 45% 비교', 'NOL · YES24 · 엘티켓 실시간 최저가', '/shows/1', 1, 1),
  (2, 'HERO', 1, 'PERK & GOODS', '포토카드 · 한정 굿즈 특전 모음', '유료 예매자 현장 증정 회차 한눈에', '/search?category=PERK', 2, 1),
  (3, 'HERO', 2, 'SINGALONG & CURTAIN CALL', '싱어롱 · 스페셜 커튼콜 이벤트', '촬영 가능 회차와 기념 데이 모아보기', '/search?category=EVENT', 3, 1),
  (4, 'SPOTLIGHT', 1, 'TODAY''S LOTTERY & SPECIAL EVENT', 'YES24데이 · NOL 로터리 · 싱어롱', '놓치기 쉬운 로터리 응모 마감과 현장 커튼콜·특전 회차를 한 번에 확인하세요.', '/search?dealType=LOTTERY', 1, 1);
