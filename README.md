# 나의 기록 공간

개인과 회사의 계획을 순서대로 연결하고, 반복하는 루틴과 매일 배운 내용을 한곳에서 관리하는 웹앱입니다.

**[웹사이트 바로가기](https://swdynamics.github.io/to_do_list/)**

## 주요 기능

| 기능 | 설명 | 접속 |
| --- | --- | --- |
| 연결 리스트 계획 | 개인·회사 계획을 구분하고, 여러 할 일을 순서대로 연결해 관리합니다. | [계획 열기](https://swdynamics.github.io/to_do_list/plan/) |
| 루틴 저장소 | 반복하는 작업 순서를 루틴으로 저장하고 새 계획으로 불러옵니다. | 계획 페이지에서 이용 |
| TIL (Today I Learned) | 배운 내용과 생각을 제목·분류·날짜와 함께 기록합니다. | [TIL 열기](https://swdynamics.github.io/to_do_list/learning/) |
| 계정과 동기화 | 로그인한 계정의 데이터를 Supabase에 저장하고 다른 기기에서 불러옵니다. | [로그인](https://swdynamics.github.io/to_do_list/auth/) |

로그인하지 않으면 현재 브라우저에 데이터를 저장합니다. 다른 브라우저나 기기에서 같은 기록을 사용하려면 웹사이트에 같은 계정으로 로그인하고 동기화 상태를 확인하세요.

## 사용 방법

1. 웹사이트에 접속해 계획 또는 TIL 메뉴를 선택합니다.
2. 계획 페이지에서 개인·회사 탭을 선택하고, 작업을 한 줄씩 입력해 계획을 만듭니다. 반복할 작업은 루틴으로 저장해 다시 사용할 수 있습니다.
3. TIL 페이지에서 배운 내용과 생각을 기록합니다.
4. 기기 간 동기화가 필요하면 로그인합니다.

## 기술 구성

- 화면과 기능: HTML, CSS, JavaScript
- 인증과 데이터 저장: Supabase Auth, PostgreSQL
- 비로그인 데이터 저장: 브라우저 localStorage
- 웹 호스팅: GitHub Pages

## 로컬 실행

별도의 빌드 과정 없이 정적 웹 서버로 실행합니다. Python이 설치되어 있다면 프로젝트 루트에서 다음 명령을 실행하세요.

```bash
python -m http.server 5500
```

환경에 따라 `python` 대신 `python3`를 사용합니다. 서버가 실행 중인 상태에서 [http://localhost:5500/](http://localhost:5500/)에 접속하세요.

Python이 없다면 VS Code의 Live Server 확장으로 `index.html`을 열어 미리 볼 수도 있습니다. 로컬 주소와 공개 사이트의 브라우저 저장 공간은 서로 분리됩니다.

## Supabase 설정

별도의 Supabase 프로젝트로 운영하려면 `shared/supabase-config.js`의 연결 정보를 설정하고 [Supabase 초기 설정 안내](supabase/README.md)에 따라 테이블과 인증 URL을 구성하세요. 인증 URL은 실제 사용하는 배포 주소와 로컬 주소에 맞춰 설정합니다.

브라우저에는 공개용 `publishable key`만 사용하며, `service_role` 키는 소스에 넣지 않습니다.
