import App from './components/App.svelte';

const target = document.getElementById('app');

if (!target) {
    throw new Error('Target container #app was not found in webview DOM');
}

const app = new App({
    target
});

export default app;
