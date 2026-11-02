const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

// Clean out directory
const outDir = './out';
if (fs.existsSync(outDir)) {
    fs.rmSync(outDir, { recursive: true });
}
fs.mkdirSync(outDir, { recursive: true });

// Build with esbuild - bundles all dependencies
esbuild.build({
    entryPoints: ['./src/extension.ts'],
    bundle: true,
    platform: 'node',
    target: 'node18',
    outfile: './out/extension.js',
    external: ['vscode'], // Don't bundle vscode API
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
}).then(() => {
    console.log('✅ Build complete: out/extension.js');
    
    // Copy non-JS files
    const resourcesDir = './out/resources';
    fs.mkdirSync(resourcesDir, { recursive: true });
    
    // Copy resources
    ['icon.png', 'icon.svg', 'hermes-icon.svg', 'hermes.agent.md', 'icon-theme.json'].forEach(file => {
        const src = `./resources/${file}`;
        const dest = `${resourcesDir}/${file}`;
        if (fs.existsSync(src)) {
            fs.copyFileSync(src, dest);
        }
    });

    // Copy utilities
    const utilsDir = './out/utils';
    fs.mkdirSync(utilsDir, { recursive: true });
    ['hermesDb.py'].forEach(file => {
        const src = `./src/utils/${file}`;
        const dest = `${utilsDir}/${file}`;
        if (fs.existsSync(src)) {
            fs.copyFileSync(src, dest);
        }
    });

    // Copy UI assets (chatView.css, chatView.js, etc.)
    const uiDir = './out/ui';
    fs.mkdirSync(uiDir, { recursive: true });
    ['chatView.css', 'chatView.js', 'setupView.css'].forEach(file => {
        const src = `./src/ui/${file}`;
        const dest = `${uiDir}/${file}`;
        if (fs.existsSync(src)) {
            fs.copyFileSync(src, dest);
        }
    });
    
    // Copy package.json, README, CHANGELOG, LICENSE
    ['package.json', 'README.md', 'CHANGELOG.md'].forEach(file => {
        if (fs.existsSync(file)) {
            fs.copyFileSync(file, `./out/${file}`);
        }
    });
    
    console.log('✅ Resources copied');
}).catch(() => process.exit(1));