# 변경 내역

## 1.1.2 (2026-10-13)

- 코드 테마 색 가져오기에서 키워드 기본색에 연산자 색이 섞이던 문제 수정
- 프로젝트 CSS 안의 `url(...)` 하나가 잘못되었거나 웹 루트 밖이면 그 CSS 파일 전체가 미리보기에 적용되지 않던 문제 수정. 해당 url만 그대로 둡니다
- Submission ID 중복·테마 가져오기 실패 안내 문구를 존댓말로 통일
- 코드 편집기가 닫힐 때 남을 수 있던 포인터 이벤트 리스너 정리

## 1.1.1 (2026-10-13)

- wpack 변환기 자동 탐색 순서 변경: Eclipse 플러그인이 쓰는 `w-pack/index.js`(실행용 `node.exe`가 있을 때)를 먼저 사용하고, 없으면 `standalone_wpack-win.exe`를 사용합니다. 오래되었거나 손상된 단독 exe가 있어 저장 시 XML → JS 변환이 실패하던 문제를 막습니다
- `w-pack/index.js`로 변환할 때 config.xml의 공통 함수 설정(`<common>`)이 적용되지 않던 문제 수정(`-cm` → `-sc`). exe와 같은 결과로 변환됩니다

## 1.1.0 (2026-10-13)

- **Submission 데이터 선택**: submission 팝업의 ref·target 옆 `데이터 선택`으로 DataMap·DataList를 여러 개 체크해 고르고, DataList 동작(ref는 all·modified·inserted·deleted·updated, target은 append)·key·형식(json·xml·array)을 정해 값을 만듭니다. 여러 개는 항목마다 한 줄로 정렬하고, 기존 값은 읽어 미리 채웁니다
- submission ref·target을 Eclipse처럼 저장: 줄바꿈을 `&#10;` 대신 그대로, `"`가 있으면 `'`로 감싸 `&quot;` 없이
- submission 팝업 너비를 900px로, ref·target 입력칸 기본 높이를 5줄로 확대
- 파일 검색(Ctrl+E) 등으로 텍스트 편집기에 열린 WebSquare 화면 XML을 자동으로 디자이너로 전환. 수동으로 연 텍스트 편집기는 유지
- 데이터 생성 구조를 WebSquare5 기본값에 맞춤: dataList의 `baseNode="list"`·`saveRemovedData="true"`, 기본 컬럼·키, linkedDataList의 filter·sort 조건
- submission 생성 시 `encoding="UTF-8"`과 빈 기본 옵션·이벤트 속성을 WebSquare5 기본 순서로 추가
- 팔레트 컴포넌트의 기본 속성·라벨·그리드 caption·탭 구조를 WebSquare5 기본값에 맞추고 새 그리드 컬럼 너비를 70으로 수정
- 붙여넣기·이동·병합 시 여러 줄 속성값 안의 줄에 들여쓰기가 붙던 문제 수정

## 1.0.0 (2026-10-12)

첫 정식 버전입니다. 자세한 기능은 [기능 설명](docs/FEATURES.md)을 참고하세요.

- **화면 디자이너**: WebSquare 화면 XML을 Design·Info·Script·Source 탭으로 편집. 프로젝트 CSS를 적용한 미리보기, 팔레트·Outline·Data 트리, 끌어서 배치·이동, Property·Event 패널, 더블클릭 편집, 화면 점검
- **그리드**: 칸 여러 개 고르기, 셀 병합·해제, 열 이동·삭제, 칸 속성 표(Excel과 복사·붙여넣기)
- **Info 탭**: 화면 정보(`meta_*`)와 개정 이력 편집
- **ERD 탭**: 화면이 쓰는 테이블·관계·메모·그룹을 그림으로 작성. 화면 XML이 아닌 이 PC 폴더에 저장
- **코드 편집기(Source·Script)**: XML·WebSquare API·공통 JS 자동완성과 설명, 파라미터 힌트, 정의로 이동, 문법 오류 표시, 포맷, 미니맵, 테마 고르기·가져오기·색 덮어쓰기
- **연결 파일**: Controller·Service·Mapper 등을 화면 탭에서 열어 편집. VS Code 언어 확장의 자동완성·설명·정의로 이동 사용. MyBatis SQL 색과 방언별 키워드 자동완성
- **시작하기**: 처음 설치하면 Eclipse 설치 폴더 선택 안내, 탐색기에서 새 화면 만들기
- **저장·Undo**: XML 원문은 바뀐 부분만 교체하고 저장·Undo는 VS Code 방식 그대로. 저장하면 wpack 변환으로 JS 산출물 갱신
