const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Intercept all requests
  page.on('request', req => {
    if (req.url().includes('localhost:3000')) {
      console.log('REQ:', req.method(), req.url());
    }
  });
  page.on('response', async resp => {
    if (resp.url().includes('localhost:3000') && resp.status() >= 400) {
      console.log('RESP ERROR:', resp.status(), resp.url());
    }
  });

  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('http://localhost:3000/', { waitUntil: 'load', timeout: 15000 });
  await page.waitForTimeout(2000);

  // Click project 1
  try {
    const projectBtn = await page.locator('button', { hasText: /^1$/ }).first();
    await projectBtn.click();
    await page.waitForTimeout(3000);
  } catch(e) {
    console.log('Could not click project 1:', e.message);
  }

  // Print body HTML to understand structure
  const bodyHTML = await page.evaluate(() => document.body.innerHTML.substring(0, 5000));
  console.log('\n--- BODY HTML (after click) ---\n', bodyHTML);

  // Take screenshot
  await page.screenshot({ path: '/tmp/preview_project_open.png', fullPage: true });
  console.log('\nScreenshot saved: /tmp/preview_project_open.png');

  await browser.close();
})();
