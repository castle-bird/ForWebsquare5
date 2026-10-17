# Eclipse 설치 폴더

**폴더:** Eclipse 또는 WebSquare Studio 설치 폴더 (예: `C:\eclipse_egov{버전}`)

비워 두면 화면 XML을 열 때 로컬 드라이브(C:·D: 등)에서 WebSquare5 설치 폴더를 자동으로 찾고, 찾은 위치를 이 PC에 기억합니다. 설치본이 여러 개면 작업 폴더와 같은 드라이브, 엔진 버전이 높은 것을 먼저 고르며 알림에서 다른 설치본으로 바꿀 수 있습니다.

설치 폴더 안에서 아래 항목을 찾습니다:

- 컴포넌트 정의 파일 (`WebSquareConfig.xml`) — Property·Event 목록에 씁니다
- wpack 변환기 (`w-pack/index.js` 또는 `standalone_wpack-win.exe`) — 화면 저장 시 JS로 변환합니다
- API 문서 폴더 (`index.html`·`$p`·`WebSquare.*`) — Script 탭 자동완성에 씁니다 (선택)

플러그인 폴더 이름은 설치본마다 달라도 괜찮습니다. 자동으로 못 찾으면 알림에서 폴더를 고르거나 다시 찾을 수 있습니다. 너무 넓은 폴더(예: `D:\`)를 골라도 그 밑의 설치본을 찾아 저장합니다.

---

직접 고른 폴더는 사용자 설정에 저장되어 모든 프로젝트에 적용됩니다. 다시 바꾸려면 F1 → **WebSquare5: 환경 설정**
