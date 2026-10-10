# 모아두기 클라우드 설정

Cloudflare/Firebase 계정 연결 전에 준비된 소스코드 설명입니다. 서버 비밀, 비밀번호, 서비스 계정 JSON은 절대 GitHub 또는 채팅에 게시하지 마세요.

## 1. Firebase 구글 로그인

1. https://console.firebase.google.com/ 에서 프로젝트를 생성합니다.
2. **Authentication → Sign-in method → Google**을 활성화하고 지원 이메일을 설정합니다.
3. **Authentication → Settings → Authorized domains**에 `flowergorge.github.io`를 등록합니다.
4. **프로젝트 설정 → 내 앱 → 웹 앱**에서 `apiKey`, `authDomain`, `projectId`, `appId`를 확인합니다.
5. 이 웹 공개 구성값을 프로젝트의 `cloud-config.js` 안 `firebase`에 넣습니다. 서비스 계정 비밀 키는 넣지 않습니다.

## 2. Cloudflare Workers + D1

1. https://dash.cloudflare.com/ 에서 Cloudflare 계정을 준비합니다.
2. Node.js 설치 후 이 프로젝트의 `worker` 폴더에서 `npx wrangler login`을 실행합니다.
3. `worker/README.md`를 참고하여 D1 데이터베이스 생성, DB ID 연결, 스키마 적용, Worker 환경변수를 설정합니다.
4. Worker 환경변수의 Firebase 프로젝트 ID는 프런트 설정의 `projectId`와 일치해야 합니다.
5. CORS 허용 Origin은 `https://flowergorge.github.io`여야 합니다.
6. `npx wrangler deploy`로 배포한 `https://....workers.dev` 주소를 `cloud-config.js`의 `apiBase`에 넣습니다.
7. GitHub `main` 브랜치에 푸시하면 Pages가 새 버전으로 배포됩니다.

## 3. PC·모바일 연동 테스트

1. 웹앱에 각각 구글 로그인하여 동일한 사용자로 인식되는지 확인합니다.
2. 한 기기에서 스크랩·태그·메모를 수정한 뒤 다른 기기에서 새로고침하여 동일한 데이터가 나오는지 확인합니다.
3. GitHub Pages 사이트에 이미 로컬 스크랩이 있다면 **로컬 가져오기** 버튼으로 클라우드에 추가합니다. 기존 기록을 자동 삭제하거나 덮어쓰지 않습니다.
4. **PC file:// 버전 이전:** 먼저 `D:\work\moadoogi\index.html`을 열어 **↓ 백업**으로 JSON 파일을 내려받습니다. 그다음 GitHub Pages에서 구글 로그인 후 **↑ 복원**으로 파일을 선택해 클라우드에 추가합니다. file://와 https://의 브라우저 저장소는 서로 다릅니다.
5. 로그아웃 버튼을 누르면 사용자의 클라우드 스크랩을 숨기고 기존 로컬 저장 모드로 돌아갑니다.
6. 제목은 공개 사이트에서만 성공할 수 있습니다. 로그인이 필요한 게시물, 사이트 봇 차단, X 제한이 있는 경우 자동으로 가져오지 못할 수 있습니다.

**알아둘 점:** 이 코드를 푸시하는 것만으로 D1과 Firebase 프로젝트가 생성되지는 않습니다. 실제 외부 서비스 설정을 완료해야 구글 로그인·온라인 제목 수집·다른 기기 동기화가 시작됩니다. 오프라인에서 변경한 내용은 이후 전송을 재시도하지만 같은 스크랩을 여러 기기에서 동시에 편집하면 마지막 저장이 우선할 수 있습니다. Android APK(공유 메뉴 포함)는 연동 검증 후 다음 단계입니다.
