# TIL 서버 웹 푸시

휴대폰의 홈 화면 TIL 앱과 PC에서 같은 Supabase 계정으로 로그인합니다.
휴대폰에서 **이 기기로 알림 받기**를 누르고 권한을 허용한 다음,
PC에서 **연결 상태 확인 → 내 등록 기기로 테스트 보내기**를 누릅니다.
로컬 알림 테스트와 달리 Push API를 통해 앱이 닫혀 있는 기기에도 발송합니다.
푸시 서비스의 접수 응답은 휴대폰에서 실제 표시됐다는 확인은 아닙니다.

## 구성

- `learning/server-push.js`: 수신 등록·해제와 계정별 발송 요청
- `learning/notification-sw.js`: 서버 push 수신과 TIL 페이지 열기
- `functions/web-push/`: 인증 검증, 등록 관리, VAPID 서명·암호화 발송
- `migrations/20260926000100_web_push.sql`: 비공개 기기 테이블 및 30초 발송 제한

서버가 Supabase Auth에서 확인한 사용자 ID만 사용합니다. 데이터베이스 테이블과
등록·발송 제한 함수는 service_role만 접근할 수 있습니다. 공개 키만 프런트엔드에 반환하며,
구독 URL·암호화 키·VAPID 비밀 키는 로그에 출력하지 않습니다.
기기는 계정당 10개까지 등록되며, 같은 브라우저를 다른 계정에 등록하면 소유 계정이 변경됩니다.
로그아웃해도 구독은 유지되므로 공용 기기는 로그아웃 전에 등록을 해제해야 합니다.
404/410으로 만료된 구독은 정리하고, 다른 오류는 재시도할 수 있도록 유지합니다.
테스트 내용은 고정되어 있고 개인 TIL 본문은 보내지 않습니다. 예약 복습 발송은 별도 기능입니다.

## 배포

1. `supabase login`으로 프로젝트 관리자 로그인.
2. SQL Editor에서 마이그레이션 파일을 실행하거나 CLI Management API로 실행:
   `supabase db query --project-ref uemhbtbvfeqhfuqzmlpt --linked --file supabase/migrations/20260926000100_web_push.sql`
   (기존 적용 여부를 먼저 확인하고 한 번만 실행합니다.)
3. `deno run --allow-env --allow-write=.secrets supabase/generate-push-keys.ts`로 키를 한 번 생성.
4. `supabase secrets set --project-ref uemhbtbvfeqhfuqzmlpt --env-file .secrets/web-push.env`
5. `supabase functions deploy web-push --project-ref uemhbtbvfeqhfuqzmlpt --use-api`
6. 프런트엔드를 GitHub Pages로 배포하고 휴대폰에서 수신 등록.

`verify_jwt = false`는 플랫폼의 기존 JWT 검사만 끕니다. 함수 안에서는 **모든 요청의
Bearer 토큰을 Auth.getUser로 검증**하므로 익명 발송은 허용되지 않습니다.
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`는 Edge Functions의 기본 서버 환경 변수입니다.
VAPID 키를 재생성하면 기존 구독을 다시 등록해야 합니다. `.secrets`는 커밋하지 않습니다.

## 확인

`deno check supabase/functions/web-push/index.ts`

`deno test --allow-env --allow-read=learning tests/web-push.test.ts`

실제 기기 확인: 아이폰 홈 화면 앱에서 등록 → 앱 닫기 → PC의 같은 계정에서 테스트 전송 →
아이폰 알림 센터에서 수신 확인 → 알림을 눌러 TIL 열기 → 등록 해제 후 재발송 대상에서 제외 확인.
