-- 기존 user_app_data 테이블에 운동 기록(운동 세트·단백질) 데이터 종류를 추가합니다.
-- Supabase Dashboard > SQL Editor에서 이 파일 전체를 한 번 실행하세요.

begin;

alter table public.user_app_data
drop constraint if exists user_app_data_data_key_check;

alter table public.user_app_data
add constraint user_app_data_data_key_check
check (data_key in ('todos', 'plans', 'learning', 'routines', 'fitness'));

commit;
