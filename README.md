# BlindPoke

정체를 숨긴 포켓몬을 단서로 식별하고, 동료로 포획해 본거지를 건설·운영하는 브라우저 게임입니다.

## 실행

```bash
npm install
npm run dev
```

개발 서버는 기본적으로 `http://127.0.0.1:5175`에서 실행됩니다.

## 검증

```bash
npm run build
npm run test:unit
npm run test:smoke
```

- `build`: TypeScript 검사와 Vite 프로덕션 번들 생성
- `test:unit`: Vitest로 게임 규칙·reducer·저장 스키마·React 컴포넌트 검증
- `test:smoke`: 실제 Chrome에서 드래프트 → 본거지 → 건설 → 저장 복원 → 사냥·식별 → 지도·배틀 흐름 검증

## 기술 구성

- React
- TypeScript
- Vite
- Zod 저장 데이터 검증
- Vitest + React Testing Library
- Playwright 스모크 테스트
- 브라우저 `localStorage` 저장

## 주요 구조

```text
src/
  App.tsx                 # 데이터 로드와 화면 라우팅
  domain/                 # 공용 타입과 순수 게임 규칙
  game/                   # GameProvider, reducer, 상태 마이그레이션
  screens/                # 드래프트·본거지·사냥·지도·배틀 React 화면
  services/               # 데이터와 저장소 접근
tests/
  smoke.mjs               # 전체 핵심 흐름 브라우저 테스트
assets/                   # 배경과 건물 이미지
data/                     # 포켓몬·타입·기술·특성 데이터
```

현재 개발 순서와 확정된 게임 규칙은 `PLAN.md`를 기준으로 합니다.
