const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1600 });
    
    try {
        await page.goto('https://cityflow.pages.dev', { waitUntil: 'networkidle0' });
        
        // Find the event card button
        const btn = await page.$('aside button');
        if (btn) {
            await btn.click();
            await new Promise(r => setTimeout(r, 25000)); // wait for map to load
            await page.screenshot({ path: 'screenshot_full.png', fullPage: true });
            console.log('Screenshot taken.');
        }
    } catch (e) {
        console.log('Error:', e);
    }
    
    await browser.close();
})();
