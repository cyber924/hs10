# 허브스튜디오10 (HS10)

Cloudflare Workers + D1 + R2 기반의 글쓰기 스튜디오 및 공개 웹진입니다. 제공된 디자인 레퍼런스의 다크 차콜 배경, 라임 포인트, 넓은 히어로, 타이포그래피를 바탕으로 새로 구현했습니다.

## 구성
- Workers: API, 인증 세션, 문서 CRUD
- D1: 사용자, 세션, 게시글
- R2: 업로드 미디어
- Static Assets: HTML/CSS/JS
- 인증: Worker 내 PBKDF2 비밀번호 해시 + HttpOnly Secure 세션 쿠키

## Cloudflare 최초 설정

1. Cloudflare에서 D1 데이터베이스를 `hs10-db` 이름으로 생성합니다.
2. 생성된 database ID를 `wrangler.jsonc`의 `REPLACE_WITH_D1_DATABASE_ID`에 입력합니다.
3. R2 버킷 `hs10-media`를 생성합니다.
4. 설치 및 DB 마이그레이션:

```bash
npm install
npx wrangler d1 migrations apply hs10-db --remote
```

5. 로컬 테스트:

```bash
npm run dev
```

6. 배포:

```bash
npm run deploy
```

## 최초 관리자 계정
배포 후 사이트에서 로그인 버튼을 누르고 **첫 관리자 계정 만들기**를 선택합니다. D1에 계정이 하나도 없을 때만 최초 관리자 계정을 생성할 수 있습니다. 비밀번호는 12자 이상입니다. 이후 공개 가입은 차단됩니다.

## 주요 기능
- 공개 웹진 글 목록 및 상세 보기
- 최초 관리자 계정 생성 및 로그인/로그아웃
- 비공개 보관함
- 글 작성, 수정, 삭제
- 초안 저장 및 공개 발행
- 외부 이미지 URL 지정
- 대표 이미지 URL 직접 입력 또는 R2 파일 업로드 및 미리보기
- R2 객체 접근 권한 확인 및 이미지 파일 시그니처 검증
- 동일 출처 변경 요청 검증 및 최초 관리자 생성 경쟁 조건 방어

## 중요
- 운영 배포 전 D1 ID와 R2 버킷을 반드시 실제 계정 값으로 설정하세요.
- Cloudflare Workers의 Secure 쿠키는 HTTPS에서 동작합니다.
- 이 저장소에는 사용자 데이터, 비밀키, 운영 계정이 포함되지 않습니다.
- 현재 구현은 단일 관리자/작성자 중심의 첫 버전입니다. 이메일 인증, 비밀번호 재설정, 로그인 시도 제한, 역할별 다중 사용자 관리, 리치 텍스트 에디터, OG 이미지 렌더링 등은 후속 개발 범위입니다. 배포 전 실제 D1 database ID를 반드시 입력하고 D1 migration을 적용해야 합니다.
