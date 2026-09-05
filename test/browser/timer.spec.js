import { expect, test } from '@playwright/test';

/** @param {import('@playwright/test').Page} page */
const digits = async (page) => (await page.locator('.time__digits').allTextContents()).join(':');
/** @param {import('@playwright/test').Page} page */
const primary = (page) => page.locator('.control-button--primary');

test('landing page stays local and keeps its saved duration', async ({ page }) => {
  /** @type {string[]} */
  const apiRequests = [];
  page.on('request', (request) => {
    if (request.url().includes('/api/')) apiRequests.push(request.url());
  });
  await page.addInitScript(() => localStorage.setItem('lightningtimer-duration', '17'));
  await page.goto('/');
  await expect.poll(() => digits(page)).toBe('00:17');
  await primary(page).click();
  await expect(primary(page)).toHaveText('Pause');
  await page.getByRole('button', { name: 'Set duration', exact: true }).click();
  await expect(primary(page)).toHaveText('Resume'); // Original local-only behavior.
  await page.getByRole('button', { name: 'Close settings' }).click();
  expect(apiRequests).toHaveLength(0);
  await page.goto('/local-storage-isolation');
  await expect(page.getByText('Synced', { exact: true })).toBeVisible();
  await expect.poll(() => digits(page)).toBe('05:00');
});

test('two machines share controls, settings and a single committed drag despite clock skew', async ({ browser }) => {
  const first = await browser.newContext();
  const second = await browser.newContext();
  try {
    await second.addInitScript(() => {
      const realNow = Date.now;
      Date.now = () => realNow() + 600000;
    });
    const a = await first.newPage();
    const b = await second.newPage();
    await Promise.all([a.goto('/shared-controls'), b.goto('/shared-controls')]);
    for (const page of [a, b]) await expect(page.getByText('Synced', { exact: true })).toBeVisible();

    await a.getByRole('button', { name: 'Set duration', exact: true }).click();
    await a.getByRole('button', { name: '3 min', exact: true }).click();
    await a.getByRole('button', { name: 'Set timer', exact: true }).click();
    await expect.poll(() => digits(b)).toBe('03:00');
    await primary(a).click();
    await expect(primary(b)).toHaveText('Pause');
    await expect.poll(() => digits(a)).not.toBe('03:00');
    await expect.poll(async () => (await digits(a)) === (await digits(b))).toBe(true);

    await a.getByRole('button', { name: 'Set duration', exact: true }).click();
    await expect(primary(b)).toHaveText('Pause'); // Opening settings doesn't pause a room.
    await a.getByRole('button', { name: 'Close settings' }).click();
    await primary(b).click();
    await expect(primary(a)).toHaveText('Resume');

    let seekCommands = 0;
    a.on('request', (request) => {
      if (request.method() === 'POST' && request.postDataJSON()?.action === 'seek') seekCommands++;
    });
    const bounds = await a.getByRole('slider').boundingBox();
    if (!bounds) throw new Error('Missing progress bar');
    await a.mouse.move(bounds.x + 10, bounds.y + 5);
    await a.mouse.down();
    await a.mouse.move(bounds.x + bounds.width / 2, bounds.y + 5, { steps: 20 });
    expect(seekCommands).toBe(0);
    await a.mouse.up();
    await expect.poll(() => seekCommands).toBe(1);
    await expect.poll(() => digits(b)).toBe('01:30');
    await expect.poll(() => digits(a)).toBe('01:30');
    await b.getByRole('button', { name: 'Reset timer', exact: true }).click();
    await expect.poll(() => digits(a)).toBe('03:00');
    await expect(primary(a)).toHaveText('Start timer');
  } finally {
    await first.close();
    await second.close();
  }
});

test('a delayed POST response cannot overwrite a newer SSE snapshot', async ({ browser }) => {
  const context = await browser.newContext();
  try {
    const a = await context.newPage();
    const b = await context.newPage();
    await Promise.all([a.goto('/revision-ordering'), b.goto('/revision-ordering')]);
    for (const page of [a, b]) await expect(page.getByText('Synced', { exact: true })).toBeVisible();

    let release = () => {};
    const delayed = new Promise((resolve) => { release = () => resolve(undefined); });
    await a.route('**/api/rooms/revision-ordering', async (route) => {
      const response = await route.fetch();
      await delayed;
      await route.fulfill({ response });
    });
    await primary(a).click();
    await expect(primary(b)).toHaveText('Pause');
    await expect(primary(a)).toBeDisabled();
    await b.getByRole('button', { name: 'Reset timer', exact: true }).click();
    await expect(primary(a)).toHaveText('Start timer');
    release();
    await expect(primary(a)).toBeEnabled();
    await expect(primary(a)).toHaveText('Start timer');
    expect(await digits(a)).toBe('05:00');
  } finally {
    await context.close();
  }
});

test('disconnected viewers keep counting, cannot issue commands, and get a fresh snapshot', async ({ browser }) => {
  const first = await browser.newContext();
  const second = await browser.newContext();
  try {
    const a = await first.newPage();
    const b = await second.newPage();
    await Promise.all([a.goto('/reconnection'), b.goto('/reconnection')]);
    for (const page of [a, b]) await expect(page.getByText('Synced', { exact: true })).toBeVisible();
    await primary(a).click();
    await expect(primary(b)).toHaveText('Pause');
    await second.setOffline(true);
    // Simulate returning to a tab while its network is unavailable.
    await b.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(b.getByText(/Reconnecting/)).toBeVisible();
    await expect(primary(b)).toBeDisabled();
    const disconnectedTime = await digits(b);
    await expect.poll(() => digits(b)).not.toBe(disconnectedTime);
    await primary(a).click();
    await a.getByRole('button', { name: 'Reset timer', exact: true }).click();
    await second.setOffline(false);
    await b.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(b.getByText('Synced', { exact: true })).toBeVisible();
    await expect(primary(b)).toBeEnabled();
    await expect(primary(b)).toHaveText('Start timer');
    await expect.poll(() => digits(b)).toBe('05:00');
  } finally {
    await first.close();
    await second.close();
  }
});
