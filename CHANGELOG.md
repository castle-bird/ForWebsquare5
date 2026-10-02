# 변경 내역

## 0.2.0 (2026-10-03)

### 새 기능

- **더블클릭 편집 확대**(캔버스·Outline 모두)
  - 선택 항목 팝업: checkcombobox(selectbox와 같음), multiselect(All·Choose Option 없음) 추가
  - multiupload 파라미터 팝업(Name·Value 표, 자식 `<param>`으로 저장)
  - output 글자 바로 편집
  - 그리드 칸(헤더·본문·footer·subTotal): 문구 아래에 width·height·inputType·dataType·id·class·maxLength 등 자주 쓰는 속성 입력
- **그리기**: 자리 표시로만 보이던 checkcombobox·multiselect·spinner·searchbox·output·calendar·multiupload를 화면에 그림
- **셀 병합**: 그리드 컬럼·group th/td를 우클릭 "병합" 또는 Ctrl+M (붙은 직사각형만)
- **화면 XML 사이 복사·붙여넣기**: a.xml에서 복사한 컴포넌트를 b.xml에 붙여넣기
- **Outline·Data 트리 F2**: id 바꾸기, id가 없는 노드는 새로 붙이기
- **Data 트리 끌어 옮기기**: Submission·DataList 등 순서 변경
- **탭**
  - Design·Script·Source 탭 줄을 위·아래로 옮기기(기본 위)
  - Property/Event·Outline/Data 탭 끌어서 순서 변경
- **연결 탭(Controller·Service 등)**
  - VS Code 문제(Java 언어 서버 등)를 그대로 오류 밑줄로 표시
  - 자동완성 설명을 마크다운으로 표시(코드 블록 등)

### 개선

- 기본 입력 컴포넌트(input·select·textarea·checkbox·radio) 디자인 통일, VS Code 테마 색 사용
- 팝업 디자인 정리: Submission·DataList·DataMap·선택 항목 팝업을 섹션으로 나누고 라벨을 입력칸 위에
- 선택 항목 팝업
  - 행을 끌어서 순서 변경
  - 데이터 바인딩(itemset)의 NodeSet·Label·Value에 직접 입력 가능(화면에서 동적으로 만드는 dataList)
- Property에서 고를 값이 있는 칸도 직접 입력 가능
- 탭 버튼 디자인(둥근 배경), 저장 안 한 표시 점 위치, Ctrl+F 찾기 창을 위로
- 캔버스 선택 정보 칩 크기 키움
- 자동완성 팝업을 Property/Event 패널 위로
- 연결 탭 자동완성 목록을 먼저 보여주고 자동 import·설명은 뒤따라 받음(Java 첫 표시가 빨라짐)
- Script 포맷을 VS Code에 설정한 JS 포매터로(확장 크기 약 4MB 감소)
- 내부 정리(안 쓰는 코드 제거, 큰 함수 분리)

### 버그 수정

- 선택 항목 팝업에서 All Option·Choose Option 체크 해제, Span Direction none, ref 비우기가 저장되지 않던 문제
- 연결 탭 Java 포맷이 "포매터 준비 중" 알림만 뜨고 적용되지 않던 문제(프로젝트 불러오기가 오래 걸리는 경우)
- 연결 탭을 열 때 오류 표시가 안 뜨던 문제
- 붙여넣기로 `xf:model` 등 화면 구조가 중복되던 문제
- 글자 편집 중 편집 상자 위로 컴포넌트 테두리가 보이던 문제
- Git 변경 표시 띠가 줄보다 위에 그려지던 문제

## 0.1.0 (2026-10-01)

- 첫 공개
