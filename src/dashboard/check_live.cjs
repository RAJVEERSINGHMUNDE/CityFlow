const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    
    try {
        await page.goto('https://cityflow.pages.dev', { waitUntil: 'networkidle0' });
        await page.screenshot({ path: 'screenshot.png' });
        console.log('Saved screenshot.png');
    } catch (e) {
        console.log('Goto error:', e);
    }
    
    await browser.close();
})();
