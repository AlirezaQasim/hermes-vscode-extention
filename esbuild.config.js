const esbuild = require('esbuild');
const sveltePlugin = require('esbuild-svelte');
const path = require('path');
const fs = require('fs');

async function buildAll() {
    // 1. Clean out directory
    const outDir = './out';
    if (fs.existsSync(outDir)) {
        fs.rmSync(outDir, { recursive: true });
    }
    fs.mkdirSync(outDir, { recursive: true });
    fs.mkdirSync(path.join(outDir, 'ui'), { recursive: true });

    // 2. Build Extension Host (Node.js)
    console.log('📦 Bundling Extension Host (src/extension.ts)...');
    await esbuild.build({
        entryPoints: ['./src/extension.ts'],
        bundle: true,
        platform: 'node',
        target: 'node18',
        outfile: './out/extension.js',
        external: ['vscode'],
        format: 'cjs',
        sourcemap: true,
        sourcesContent: false,
        treeShaking: true,
        minify: false,
        keepNames: true,
        define: {
            'process.env.NODE_ENV': '"production"'
        },
        banner: {
            js: '// Hermes VS Code Extension - Bundled with esbuild'
        }
    });
    console.log('✅ Extension Host bundled: out/extension.js');

    // 3. Build Webview with Svelte (Browser)
    console.log('🎨 Bundling Svelte Webview (src/ui/webview/main.ts)...');
    await esbuild.build({
        entryPoints: ['./src/ui/webview/main.ts'],
        bundle: true,
        outfile: './out/ui/chatView.js',
        format: 'iife',
        platform: 'browser',
        target: 'es2020',
        sourcemap: true,
        treeShaking: true,
        minify: false,
        plugins: [
            sveltePlugin({
                compilerOptions: {
                    css: 'injected'
                }
            })
        ],
        define: {
            'process.env.NODE_ENV': '"production"'
        }
    });
    console.log('✅ Svelte Webview bundled: out/ui/chatView.js');

    // 4. Copy Resources
    const resourcesDir = './out/resources';
    fs.mkdirSync(resourcesDir, { recursive: true });
    ['icon.png', 'icon.svg', 'hermes-icon.svg', 'hermes.agent.md', 'icon-theme.json'].forEach(file => {
        const src = `./resources/${file}`;
        const dest = `${resourcesDir}/${file}`;
        if (fs.existsSync(src)) {
            fs.copyFileSync(src, dest);
        }
    });

    // 5. Copy Utilities
    const utilsDir = './out/utils';
    fs.mkdirSync(utilsDir, { recursive: true });
    ['hermesDb.py'].forEach(file => {
        const src = `./src/utils/${file}`;
        const dest = `${utilsDir}/${file}`;
        if (fs.existsSync(src)) {
            fs.copyFileSync(src, dest);
        }
    });

    // 6. Copy UI Assets
    const uiDir = './out/ui';
    fs.mkdirSync(uiDir, { recursive: true });
    ['chatView.css', 'setupView.css'].forEach(file => {
        const src = `./src/ui/${file}`;
        const dest = `${uiDir}/${file}`;
        if (fs.existsSync(src)) {
            fs.copyFileSync(src, dest);
        }
    });

    // 7. Copy metadata files
    ['package.json', 'README.md', 'CHANGELOG.md'].forEach(file => {
        if (fs.existsSync(file)) {
            fs.copyFileSync(file, `./out/${file}`);
        }
    });

    console.log('✅ All assets & resources bundled and copied successfully!');
}

buildAll().catch((err) => {
    console.error('❌ Build failed:', err);
    process.exit(1);
});
