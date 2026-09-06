# 연수 협업 보드판

연수(교원 자율연수) 참여 선생님들이 각자 접속해 실시간으로 함께 사용하는 포스트잇 협업 보드판입니다.
빌드 도구 없이 순수 HTML/CSS/JS로 만들어져 있고, 데이터는 Firebase Firestore에 실시간으로 저장/동기화됩니다.

## 폴더 구조

```
public/
  index.html         홈 화면 (보드판 목록, 만들기)
  board.html          보드판 화면 (포스트잇/단원명, 캡쳐, 삭제)
  css/style.css
  js/firebase.js      Firebase 프로젝트 설정 및 초기화
  js/home.js          홈 화면 로직
  js/board.js          보드판 화면 로직
firestore.rules       Firestore 보안 규칙
firebase.json          Firebase Hosting 설정
.firebaserc             연결된 Firebase 프로젝트 (sticky-note-board-4cefc)
```

## 기능 요약

- **홈 화면**: 제목, "보드판 만들기" 버튼(학교명 + 숫자 4자리 비밀번호), 만들어진 보드판이 사각 카드로 실시간 표시됩니다.
  - 카드를 클릭하면 비밀번호 확인 후 입장합니다.
  - 카드 우측 상단 휴지통 아이콘을 누르면 비밀번호 확인 후 보드판 전체(모든 포스트잇 포함)가 삭제됩니다.
- **보드판 화면**: 상단에 `[학교명]의 학교자율시간 활동내용` 제목이 표시됩니다.
  - 좌측 하단 "+ 포스트잇 추가": 노란색 메모지 느낌의 포스트잇 생성 (좌우 화면의 1/4, 위아래 2줄 정도 크기), 자유롭게 드래그 가능.
  - 그 옆 "+ 단원명 추가": 포스트잇과 같은 기본 크기지만 메모지 느낌이 아닌 다른 색(파란색) 박스 생성, 내용이 길어지면 세로로 자동으로 커짐, 드래그 가능.
  - 각 박스에 마우스를 올리면 우측 상단에 작은 × 삭제 버튼이 나타나 개별 삭제가 가능합니다 (요청엔 없었지만 잘못 만든 박스를 지울 수 있도록 추가했습니다).
  - "📷 사진캡쳐": 현재 보드판 내용을 이미지로 캡쳐해 자동으로 다운로드합니다.
  - 좌측 상단 휴지통 아이콘: "정말 삭제하시겠습니까?" 확인 후 보드판 전체를 삭제하고 홈으로 이동합니다 (이미 비밀번호로 입장했으므로 재입력은 받지 않습니다).
  - 모든 선생님이 같은 보드판에 동시에 접속해 실시간으로 포스트잇을 추가/이동/편집/삭제할 수 있습니다.
  - 하단에 "만든이: 강형권 선생님" 표시.

## Firebase 연동 상태

- 프로젝트: `sticky-note-board-4cefc` (Firestore 사용)
- `public/js/firebase.js`에 프로젝트 설정(config)이 이미 반영되어 있어, 별도 설정 없이 그대로 정적 호스팅에 올리면 동작합니다.

### Firestore 데이터 구조

```
boards (collection)
  {boardId}
    schoolName: string
    password: string (숫자 4자리)
    createdAt: timestamp
    notes (subcollection)
      {noteId}
        type: "sticky" | "unit"
        text: string
        x: number
        y: number
        createdAt: timestamp
```

### 보안 규칙 (firestore.rules)

로그인 시스템이 없는 내부용 연수 도구 특성상, 비밀번호 확인은 앱(클라이언트) 단에서 처리하고 Firestore 규칙은 앱을 통한 정상적인 사용을 막지 않도록 읽기/쓰기를 열어두었습니다. 민감한 개인정보를 다루지 않는 용도로만 사용해 주세요.

콘솔에서 규칙을 반영하려면 Firebase 콘솔 → Firestore Database → 규칙 탭에 `firestore.rules` 내용을 붙여넣고 게시하면 됩니다. Firebase CLI가 있다면 아래 명령으로도 배포할 수 있습니다.

```bash
firebase deploy --only firestore:rules
```

## 배포 방법 (Firebase Hosting)

1. Firebase CLI 설치 (최초 1회): `npm install -g firebase-tools`
2. 로그인: `firebase login`
3. 이 저장소 루트에서 배포: `firebase deploy --only hosting`
4. 배포가 끝나면 안내되는 `https://sticky-note-board-4cefc.web.app` 주소로 접속하면 됩니다.

Firebase Hosting이 아니어도 `public/` 폴더를 그대로 올릴 수 있는 정적 호스팅(예: Netlify, Vercel, GitHub Pages 등)이면 동일하게 동작합니다.

## 로컬에서 미리 보기

```bash
cd public
python3 -m http.server 8080
```

브라우저에서 `http://localhost:8080` 접속.

## 알려진 제한 사항

- 비밀번호는 별도 인증 없이 클라이언트에서 대조하는 방식으로, 완전한 보안은 아닙니다. 연수용 내부 도구로 가볍게 사용하는 용도에 맞춰져 있습니다.
- 사진캡쳐 기능은 `html2canvas` 라이브러리(CDN)를 사용하므로 실제 배포 환경(인터넷 연결)에서 정상 동작합니다.
