# Supabase 초기 설정

1. Supabase Dashboard에서 현재 프로젝트를 엽니다.
2. **SQL Editor → New query**에서 [`schema.sql`](./schema.sql) 전체를 실행합니다.

   이미 `schema.sql`을 실행한 프로젝트에 루틴 기능을 추가하는 경우에는
   [`routines-migration.sql`](./routines-migration.sql)만 한 번 실행하면 됩니다.
3. **Authentication → URL Configuration**에서 다음 값을 등록합니다.

   - Site URL: `https://swdynamics.github.io/to_do_list/`
   - Redirect URLs:
     - `https://swdynamics.github.io/to_do_list/auth/`
     - `http://localhost:5500/auth/`

4. 로컬에서는 프로젝트 루트에서 아래 명령으로 실행합니다.

   ```bash
   python3 -m http.server 5500
   ```

5. `http://localhost:5500/auth/`에서 가입한 뒤 인증 메일의 링크를 누릅니다.

`publishable key`는 브라우저에서 공개되어도 되는 키입니다. `service_role` 키는 이 프로젝트 파일에 넣거나 외부에 공유하면 안 됩니다.
