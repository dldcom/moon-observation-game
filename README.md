# 달의 생김새가 궁금해!

Three.js로 만든 초등 과학 수업용 달 관찰 웹게임 프로토타입입니다.

> 현재는 개발 중인 프로토타입이며 최종본이 아닙니다.

## 현재 구현

- 픽셀 아트 감성의 달 캐릭터와 타이핑 대화
- 3D 달 형성 과정: 운석 충돌, 크레이터, 용암, 달의 바다
- 실제 달 관찰 페이지
- NASA LRO 기반 USGS 달 표면 텍스처를 사용한 3D 달 회전·확대 관찰
- 데스크톱 마우스와 태블릿 터치 입력

## 실행

```bash
npm install
npm run dev
```

브라우저에서 `http://127.0.0.1:5188`을 엽니다.

## 검증

```bash
npm run build
npm test
```

## 기술 스택

- TypeScript
- Vite
- Three.js
- Playwright

## 달 표면 자료

`public/assets/moon/moon-global.png`는 USGS Astrogeology Science Center에서 제공하는 공개 Clementine UV/VIS 전역 달 모자이크를 브라우저용으로 내보낸 텍스처입니다. 자세한 출처는 [텍스처 README](public/assets/moon/README.md)를 참고하세요.
