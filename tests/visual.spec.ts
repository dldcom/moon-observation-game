import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';

type CanvasSample = {
  ok: boolean;
  variance: number;
  colorBuckets: number;
};

async function sampleCanvas(page: import('@playwright/test').Page): Promise<CanvasSample> {
  const canvas = page.locator('#game-canvas');
  const box = await canvas.boundingBox();
  if (!box || box.width < 32 || box.height < 32) {
    return { ok: false, variance: 0, colorBuckets: 0 };
  }

  const buffer = await canvas.screenshot();
  const png = PNG.sync.read(buffer);
  let min = 255;
  let max = 0;
  const buckets = new Set<string>();
  const stride = Math.max(1, Math.floor((png.width * png.height) / 4096));

  for (let pixel = 0; pixel < png.width * png.height; pixel += stride) {
    const offset = pixel * 4;
    const r = png.data[offset];
    const g = png.data[offset + 1];
    const b = png.data[offset + 2];
    min = Math.min(min, r, g, b);
    max = Math.max(max, r, g, b);
    buckets.add(`${r >> 4},${g >> 4},${b >> 4}`);
  }

  const variance = max - min;
  return { ok: variance > 8 && buckets.size > 3, variance, colorBuckets: buckets.size };
}

async function finishAndTap(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.typing === false);
  const previousLine = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.lineIndex ?? -1);
  await page.mouse.click(40, 180);
  await page.waitForFunction(
    (lineIndex) => (window.__THREE_GAME_DIAGNOSTICS__?.lineIndex ?? lineIndex) > lineIndex,
    previousLine,
  );
}

test('narrative slice renders and progresses through the 3D moon formation story', async ({ page }, testInfo) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await expect(page.locator('#game-canvas')).toBeVisible();
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 10);

  const sample = await sampleCanvas(page);
  expect(sample, JSON.stringify(sample)).toMatchObject({ ok: true });
  await expect(page.locator('#main-menu-ui')).toBeVisible();
  await expect(page.locator('#dialogue-panel')).toBeHidden();
  await page.locator('#main-moon-button').click();
  await expect(page.locator('#dialogue-text')).toContainText('안녕? 무슨 일이야?');
  await expect(page.locator('#main-menu-choices')).toBeVisible();
  await page.locator('#formation-choice').click();
  await expect(page.locator('#dialogue-text')).toContainText('안녕! 나는 달이야.');

  await finishAndTap(page); // intro -> secret
  await expect(page.locator('#dialogue-text')).toContainText('어쩌다 이런 모양');
  await finishAndTap(page); // secret -> 45억 년 전, with fade
  await expect.poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.stage)).toBe('smooth');
  await page.waitForTimeout(500); // allow the fade-in half of the scene transition to finish
  await finishAndTap(page); // 45억 년 전 -> smooth face
  await finishAndTap(page); // smooth face -> meteors
  await expect.poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.stage)).toBe('impacts');
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.meteorCount ?? 0))
    .toBeGreaterThan(18);
  const formationTargets = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.meteorTargetIndices ?? []);
  expect(formationTargets.length).toBeGreaterThan(18);
  expect(formationTargets.every((targetIndex) => targetIndex < 12)).toBe(true);
  const canvasBox = await page.locator('#game-canvas').boundingBox();
  expect(canvasBox).not.toBeNull();
  if (canvasBox) {
    await page.waitForFunction(() => window.__THREE_GAME_DIAGNOSTICS__?.typing === false);
    const startYaw = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.moon.rotation?.yaw ?? 0);
    await page.mouse.move(canvasBox.x + canvasBox.width * 0.5, canvasBox.y + canvasBox.height * 0.36);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + canvasBox.width * 0.64, canvasBox.y + canvasBox.height * 0.36, { steps: 4 });
    await page.mouse.up();
    await expect
      .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.stage))
      .toBe('lava');
    const endYaw = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.moon.rotation?.yaw ?? 0);
    expect(Math.abs(endYaw - startYaw)).toBeLessThan(0.001);
  } else {
    await finishAndTap(page); // impacts -> lava
  }
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.moon.craterCount ?? 0))
    .toBeGreaterThan(0);

  await expect.poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.stage)).toBe('lava');
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.moon.craterCount ?? 0))
    .toBe(12);
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.moon.activeLavaSourceCount ?? 0))
    .toBe(3);
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.moon.activeLavaCraterCount ?? 0))
    .toBe(3);
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.moon.lavaSourceCount ?? 0))
    .toBe(3);
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.moon.lavaFlowProgress ?? 0))
    .toBeGreaterThan(0);
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.moon.lavaCoolingProgress ?? 0))
    .toBeGreaterThan(0);
  await finishAndTap(page); // lava -> final craters
  await expect.poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.stage)).toBe('cratered');
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.moon.craterCount ?? 0))
    .toBe(12);
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.meteorCount ?? 0))
    .toBeGreaterThan(8);
  const lateTargets = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.meteorTargetIndices ?? []);
  expect(lateTargets.length).toBeGreaterThan(0);
  expect(lateTargets.every((targetIndex) => targetIndex >= 12 && targetIndex < 20)).toBe(true);
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.moon.craterCount ?? 0))
    .toBe(20);
  await finishAndTap(page); // final -> observation CTA
  await expect(page.locator('#observation-cta')).toBeVisible();
  await page.locator('#observe-button').click();
  await expect(page.locator('#observation-ui')).toBeVisible();
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.observation.status))
    .toBe('ready');

  const mareHotspot = page.locator('#observation-hotspots [data-feature="mare"]');
  const craterHotspot = page.locator('#observation-hotspots [data-feature="crater"]');
  await expect(mareHotspot).toBeVisible();
  await expect(craterHotspot).toBeVisible();
  await mareHotspot.click();
  await expect(page.locator('#observation-feature-modal')).toBeVisible();
  await expect(page.locator('#observation-feature-title')).toHaveText('달의 바다');
  await expect(page.locator('#observation-feature-dialogue')).toContainText('물이 있는 바다가 아니라');
  await expect(page.locator('#observation-feature-location')).toHaveCount(0);
  await expect(page.locator('#observation-feature-dialogue')).not.toContainText('마레 세레니타티스');
  await expect(page.locator('#observation-feature-preview')).toHaveJSProperty('width', 720);
  const hasPreviewMarker = await page.locator('#observation-feature-preview').evaluate((canvas) => {
    const canvasElement = canvas as HTMLCanvasElement;
    const context = canvasElement.getContext('2d');
    if (!context) return true;
    const pixels = context.getImageData(0, 0, canvasElement.width, canvasElement.height).data;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      if (pixels[offset] > 180 && pixels[offset + 1] > 130 && pixels[offset + 2] < 130) return true;
    }
    return false;
  });
  expect(hasPreviewMarker).toBe(false);
  await page.locator('#observation-feature-close').click();
  await expect(page.locator('#observation-feature-modal')).toBeHidden();
  await craterHotspot.click();
  await expect(page.locator('#observation-feature-modal')).toBeVisible();
  await expect(page.locator('#observation-feature-title')).toHaveText('충돌 구덩이');
  await expect(page.locator('#observation-feature-dialogue')).toContainText('여기는 충돌 구덩이야');
  await page.locator('#observation-feature-close').click();
  await expect(page.locator('#observation-feature-modal')).toBeHidden();

  const moonBox = await page.locator('#game-canvas').boundingBox();
  expect(moonBox).not.toBeNull();
  if (moonBox) {
    const startYaw = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.observation.yaw ?? 0);
    await page.mouse.move(moonBox.x + moonBox.width * 0.5, moonBox.y + moonBox.height * 0.5);
    await page.mouse.down();
    await page.mouse.move(moonBox.x + moonBox.width * 0.64, moonBox.y + moonBox.height * 0.5, { steps: 4 });
    await page.mouse.up();
    await expect
      .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.observation.yaw ?? 0))
      .not.toBe(startYaw);
  }

  await page.locator('#observation-reset').click();
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.observation.distance ?? 0))
    .toBe(15.5);

  const screenshot = await page.screenshot({ fullPage: true });
  await testInfo.attach(`${testInfo.project.name}-moon-story`, {
    body: screenshot,
    contentType: 'image/png',
  });

  await page.locator('#observation-back').click();
  await expect(page.locator('#observation-ui')).toBeHidden();
  await expect(page.locator('#observation-cta')).toBeHidden();
  await expect(page.locator('#main-menu-ui')).toBeVisible();
  await expect(page.locator('#dialogue-panel')).toBeHidden();

  await page.locator('#main-moon-button').click();
  await expect(page.locator('#main-menu-choices')).toBeVisible();
  await page.locator('#observation-choice').click();
  await expect(page.locator('#observation-ui')).toBeVisible();
  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.observation.status))
    .toBe('ready');
  await page.locator('#observation-back').click();
  await expect(page.locator('#main-menu-ui')).toBeVisible();

  await page.locator('#main-moon-button').click();
  await expect(page.locator('#main-menu-choices')).toBeVisible();
  await page.locator('#game-choice').click();
  await expect(page.locator('#game-placeholder')).toBeVisible();
  await page.locator('#game-placeholder-back').click();
  await expect(page.locator('#game-placeholder')).toBeHidden();
  await expect(page.locator('#main-menu-ui')).toBeVisible();

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
});
