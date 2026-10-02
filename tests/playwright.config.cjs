const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
    testDir: './browser',
    workers: 1,
    use: { baseURL: 'http://127.0.0.1:8766', channel: 'chrome' },
    webServer: {
        command: 'python3 -m http.server 8766 --bind 127.0.0.1',
        cwd: '..',
        url: 'http://127.0.0.1:8766',
        reuseExistingServer: false,
        stderr: 'ignore'
    }
});
