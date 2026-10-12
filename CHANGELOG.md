# 변경 내역

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
