# For Websquare5

VS Code에서 WebSquare5 화면을 편집하는 **비공식** 확장입니다.
화면 XML을 Design·Info·Script·Source 탭으로 열고, Controller·Service·Mapper·MyBatis 파일도 같은 창의 탭으로 연결해 작업합니다.

![Design 탭](images/designTab.png)

> 스크린샷은 [WebSquare5 교육용 개발팩](https://media.inswave.kr/edu/WEBSQUARE_DEV_PACK_SP5_edu.zip) 샘플 프로젝트입니다. 샘플 화면·코드의 저작권은 Inswave Systems에 있습니다.

## 주요 기능

- **Design**: 프로젝트 CSS를 적용한 미리보기, 선택·크기 조절·이동, 복사·붙여넣기·삭제, 팔레트로 컴포넌트 추가
- **그리드**: 열 너비, 셀 병합·해제, 열 이동·삭제, 칸 속성 표(Excel처럼 범위 복사·붙여넣기)
- **팝업 편집**: DataList·DataMap·Submission·선택 항목을 더블클릭으로 편집
- **Property / Event / Outline / Data 패널**: 속성·이벤트 편집, 트리 이동·바인딩, 화면 점검(겹치는 id·없는 컬럼 등)
- **Info**: 프로그램 정보와 개정 이력
- **Script·Source**: 자동완성, 마우스 오버 설명, 정의로 이동, 파라미터 힌트, 포맷, 문법 오류 표시, 코드 테마
- **연결 파일**: Java·XML·SQL 파일을 화면 탭으로 열어 편집(설치된 언어 확장의 자동완성·포맷 사용)
- **ERD**: 화면이 쓰는 테이블을 적고 관계를 그림으로 보기(이 PC에만 저장)
- **저장**: 저장하면 wpack 변환으로 JS 산출물 갱신

XML은 바뀐 부분만 고치고, 저장·Undo는 VS Code 방식 그대로입니다.

자세한 기능 설명은 [FEATURES.md](FEATURES.md)에 있습니다.

![Script 탭](images/scriptTab.png)

![연결 파일 탭](images/java1.png)

## 사용 전 준비

이 확장은 **사용 권한이 있는 WebSquare5 환경**에서 동작합니다.

- VS Code 1.125 이상(또는 Cursor·Antigravity 등 VS Code 기반 편집기)
- WebSquare5 프로젝트(작업 폴더에 `websquare/config.xml`)
- WebSquare5 설정 파일 폴더(컴포넌트 정의 `WebSquareConfig.xml`, wpack 변환기, API 문서. 예: `eclipse_egov4.1/`)

## 설치

- **VS Code**: 확장 탭에서 "For Websquare5" 검색(Marketplace)
- **Cursor·Antigravity 등**: 같은 이름으로 검색([Open VSX](https://open-vsx.org))
- **직접 설치**: [Releases](https://github.com/castle-bird/ForWebsquare5/releases)에서 `.vsix`를 받아

```bash
code --install-extension websquare5-editor-0.7.0.vsix
```

## 처음 설정

1. WebSquare5 프로젝트 폴더를 엽니다.
2. `F1` → **Welcome: Open Walkthrough...** → **WebSquare5 Editor 시작하기**
3. **폴더 선택**으로 WebSquare5 설정 파일 폴더를 고르면 필요한 파일을 자동으로 찾습니다.

`F1` → **WebSquare5: 환경 설정**이나 설정(`websquare5-editor.*`)에서 직접 바꿀 수도 있습니다.

## 피드백

WebSquare5 교육용 개발팩 기준으로 만들고 확인했습니다. 자체 렌더러라 실제 엔진과 모양이 다를 수 있습니다.
안 맞는 부분이나 필요한 기능은 [Issues](https://github.com/castle-bird/ForWebsquare5/issues)로 알려 주세요.

## 고지 사항

- **비공식 도구**: Inswave Systems의 공식 제품이 아니며 Inswave와 무관한 개인 프로젝트입니다. WebSquare는 Inswave Systems의 제품·상표입니다.
- **독립 구현**: WebSquare 엔진·스킨·컴포넌트 정의·wpack·문서·아이콘 등 Inswave의 파일을 포함하지 않으며, Studio 소스를 복사·포팅하지 않았습니다. 공개 문서와 실행 결과를 참고해 작성했습니다.
- **WebSquare 환경 의존**: 작업 폴더와 설치본의 WebSquare 리소스를 실행 중에 읽습니다. WebSquare 프로젝트가 아니면 변환·컴포넌트 목록·속성 조회가 동작하지 않습니다.
- **테마 이름**: "IntelliJ Dark"·"IntelliJ Light"는 IntelliJ New UI 느낌을 참고해 직접 맞춘 색으로, JetBrains와 무관합니다. IntelliJ는 JetBrains s.r.o.의 상표입니다. "One Dark"·"One Light"는 Atom One 테마의 색을 참고해 직접 작성했습니다.

## 라이선스

[MIT License](LICENSE)
