# 모아두기 Android 공유 앱

Android 8.0 이상. 앱 이름 `모아두기`, 패키지 `io.github.flowergorge.moadoogi`.

다른 앱의 **공유 → 모아두기 → 이 계정에 저장**으로 링크/텍스트를 저장합니다.
앱 아이콘을 실행하면 계정 관리만 표시합니다. 목록/수정/삭제는 기존 웹에서 합니다.

이 APK는 Android ACTION_SEND 수신기와 Custom Tabs를 사용합니다. 전체 웹앱 대신
`mobile.html` 저장·계정 전용 화면을 엽니다. 지원 브라우저가 필요하며 위쪽에 브라우저
닫기/메뉴 표시가 있습니다. 인터넷 연결이 필요하고 오프라인 자동 저장은 지원하지 않습니다.

Firebase 웹 로그인은 브라우저 local persistence로 유지됩니다. 같은 브라우저의
모아두기 웹과 계정을 공유하므로 계정 변경/로그아웃은 웹에도 적용됩니다.
브라우저를 바꾸거나 데이터를 지우거나 Google이 세션을 취소하면 다시 로그인해야 합니다.
인증 토큰을 Android 앱으로 복사하지 않으며 추가 Android OAuth client 등록은 필요 없습니다.

공유 내용은 URL fragment로 전달하고 페이지에서 즉시 주소에서 제거합니다.
저장 버튼을 눌러야 쓰기 요청이 발생합니다. 공유마다 UUID를 발급하고 같은 작업의
재시도에는 같은 item ID와 payload를 보내며, 모호한 실패 뒤 다른 UID로 재전송하지 않습니다.
서버가 저장 성공을 응답하기 전에는 완료로 표시하지 않습니다.
제목 조회가 차단되면 공유받은 제목/텍스트로 저장합니다.

## 빌드

JDK 17, Android SDK platform/build-tools 35, Python 3 사용:

```sh
python build_apk.py --sdk /path/to/android-sdk --jdk /path/to/jdk17
```

Windows에서도 Python 빌드 명령을 사용할 수 있습니다. SDK/JDK 경로에 공백이 있으면 따옴표로 감쌉니다.
`ANDROID_HOME` / `JAVA_HOME`이 있으면 경로 옵션을 생략할 수 있습니다.
출력은 `app/build/manual/moadoogi-unsigned.apk`입니다.
서명하려면 `--keystore <키 파일> --password-file <비밀번호 파일>` 옵션을 함께 넘깁니다.
이 경우 zipalign 후 apksigner 서명·검증까지 수행하고 `moadoogi-share-v1.0.0.apk`를 생성합니다.
Gradle/Android Studio 환경이 있으면 프로젝트를 열어 일반 빌드도 가능합니다.
키/비밀번호는 Git에 넣지 않습니다. 같은 키를 유지해야 설치된 앱을 업데이트할 수 있습니다.

## 검증 범위

`node --test tests/*.test.mjs worker/tests/*.test.mjs`는 웹 회귀 테스트입니다.
실기기에서 공유 수신, 첫 Google 로그인, 재실행 로그인 유지, 저장 결과의 웹 표시,
계정 변경/로그아웃을 확인합니다. 데스크톱 mock 테스트는 실제 Google 인증 검증을 대신하지 않습니다.
