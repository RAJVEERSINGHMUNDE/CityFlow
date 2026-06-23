const puppeteer = require('puppeteer');

(async () => {
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    
    page.on('console', msg => {
        if (msg.type() === 'error') {
            console.log('PAGE ERROR:', msg.text());
        }
    });

    page.on('pageerror', error => {
        console.log('PAGE EXCEPTION:', error.message);
    });

    try {
        await page.goto('https://cityflow.pages.dev', { waitUntil: 'networkidle0' });
        
        // Find the event card button
        const btn = await page.$('aside button');
        if (btn) {
            console.log('Clicking first button in aside (could be Load Demo or Event)');
            await btn.click();
            await new Promise(r => setTimeout(r, 5000)); // wait for load
            await page.screenshot({ path: 'screenshot_test.png' });
            console.log('Screenshot taken.');
        } else {
            console.log('No buttons found in aside!');
        }
    } catch (e) {
        console.log('Error:', e);
    }
    
    await browser.close();
})();
