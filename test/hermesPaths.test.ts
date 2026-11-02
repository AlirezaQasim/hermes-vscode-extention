import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { getHermesHome, getHermesCliPath, getHermesSafeCwd, getPythonExecutablePath } from '../src/utils/hermesPaths';

describe('hermesPaths', () => {
    test('getHermesHome returns a valid path', () => {
        const home = getHermesHome();
        expect(typeof home).toBe('string');
        expect(home.length).toBeGreaterThan(0);
        if (process.platform === 'win32') {
            expect(home.toLowerCase()).toContain('hermes');
        } else {
            expect(home).toContain('.hermes');
        }
    });

    test('getHermesCliPath resolves an executable path', () => {
        const cliPath = getHermesCliPath();
        expect(typeof cliPath).toBe('string');
        expect(cliPath.length).toBeGreaterThan(0);
    });

    test('getPythonExecutablePath resolves python on any platform', () => {
        const py = getPythonExecutablePath();
        expect(typeof py).toBe('string');
        expect(py.length).toBeGreaterThan(0);
    });

    test('getHermesSafeCwd returns an existing directory', () => {
        const safeCwd = getHermesSafeCwd();
        expect(fs.existsSync(safeCwd)).toBe(true);
    });

    test('getHermesSafeCwd respects valid workspace CWD', () => {
        const tmpDir = os.tmpdir();
        const safeCwd = getHermesSafeCwd(undefined, tmpDir);
        expect(safeCwd).toBe(tmpDir);
    });
});
