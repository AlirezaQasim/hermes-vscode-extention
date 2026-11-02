import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execSync } from 'child_process';

/**
 * Resolves the Hermes home directory across Windows, macOS, and Linux.
 * Follows Hermes Agent's internal `get_hermes_home()` convention:
 * - On Windows: %LOCALAPPDATA%\hermes (with fallback to %USERPROFILE%\AppData\Local\hermes or ~/.hermes)
 * - On macOS: ~/.hermes (fallback: ~/Library/Application Support/hermes)
 * - On Linux: ~/.hermes (fallback: $XDG_DATA_HOME/hermes or ~/.local/share/hermes or ~/.config/hermes)
 */
export function getHermesHome(): string {
    // 1. Explicit environment variable override
    if (process.env.HERMES_HOME && process.env.HERMES_HOME.trim() !== '') {
        const customPath = process.env.HERMES_HOME.trim();
        if (fs.existsSync(customPath)) {
            return customPath;
        }
    }

    if (process.platform === 'win32') {
        const localAppData = process.env.LOCALAPPDATA;
        if (localAppData) {
            const localHermes = path.join(localAppData, 'hermes');
            if (fs.existsSync(localHermes)) {
                return localHermes;
            }
        }

        const userProfile = process.env.USERPROFILE || os.homedir();
        const appDataHermes = path.join(userProfile, 'AppData', 'Local', 'hermes');
        if (fs.existsSync(appDataHermes)) {
            return appDataHermes;
        }

        const dotHermes = path.join(userProfile, '.hermes');
        if (fs.existsSync(dotHermes)) {
            return dotHermes;
        }

        return localAppData ? path.join(localAppData, 'hermes') : appDataHermes;
    } else if (process.platform === 'darwin') {
        // macOS
        const home = process.env.HOME || os.homedir();
        const dotHermes = path.join(home, '.hermes');
        if (fs.existsSync(dotHermes)) {
            return dotHermes;
        }

        const appSupport = path.join(home, 'Library', 'Application Support', 'hermes');
        if (fs.existsSync(appSupport)) {
            return appSupport;
        }

        return dotHermes;
    } else {
        // Linux / BSD
        const home = process.env.HOME || os.homedir();
        const dotHermes = path.join(home, '.hermes');
        if (fs.existsSync(dotHermes)) {
            return dotHermes;
        }

        const xdgData = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');
        const xdgHermes = path.join(xdgData, 'hermes');
        if (fs.existsSync(xdgHermes)) {
            return xdgHermes;
        }

        const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(home, '.config');
        const configHermes = path.join(xdgConfig, 'hermes');
        if (fs.existsSync(configHermes)) {
            return configHermes;
        }

        return dotHermes;
    }
}

/**
 * Locates the executable for Hermes CLI across Windows, macOS, and Linux.
 * Checks in:
 * 1. Specific command passed in settings (if valid and not generic 'hermes')
 * 2. <hermesHome>/bin/hermes.cmd or hermes.exe (Windows)
 * 3. <hermesHome>/bin/hermes
 * 4. Homebrew on macOS: /opt/homebrew/bin/hermes (Apple Silicon) or /usr/local/bin/hermes (Intel)
 * 5. Linux paths: ~/.local/bin/hermes, /usr/local/bin/hermes, /usr/bin/hermes, ~/.cargo/bin/hermes
 * 6. System PATH via 'where.exe' (Windows) or 'which' (POSIX)
 * 7. Fallback 'hermes'
 */
export function getHermesCliPath(configuredCommand?: string): string {
    if (configuredCommand && configuredCommand.trim() !== '' && configuredCommand.trim() !== 'hermes') {
        const trimmed = configuredCommand.trim();
        if (fs.existsSync(trimmed)) {
            return trimmed;
        }
    }

    const hermesHome = getHermesHome();

    if (process.platform === 'win32') {
        const binCmd = path.join(hermesHome, 'bin', 'hermes.cmd');
        if (fs.existsSync(binCmd)) {
            return binCmd;
        }

        const binExe = path.join(hermesHome, 'bin', 'hermes.exe');
        if (fs.existsSync(binExe)) {
            return binExe;
        }

        try {
            const stdout = execSync('where.exe hermes', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
            const firstLine = stdout.split(/\r?\n/).find(line => line.trim().length > 0 && fs.existsSync(line.trim()));
            if (firstLine) {
                return firstLine.trim();
            }
        } catch {
            // where.exe failed
        }

        return binCmd;
    } else if (process.platform === 'darwin') {
        const candidates = [
            path.join(hermesHome, 'bin', 'hermes'),
            '/opt/homebrew/bin/hermes',
            '/usr/local/bin/hermes',
            path.join(os.homedir(), '.local', 'bin', 'hermes')
        ];

        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }

        try {
            const stdout = execSync('which hermes', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
            const firstLine = stdout.split(/\n/).find(line => line.trim().length > 0);
            if (firstLine && fs.existsSync(firstLine.trim())) {
                return firstLine.trim();
            }
        } catch {}

        return path.join(hermesHome, 'bin', 'hermes');
    } else {
        const candidates = [
            path.join(hermesHome, 'bin', 'hermes'),
            path.join(os.homedir(), '.local', 'bin', 'hermes'),
            '/usr/local/bin/hermes',
            '/usr/bin/hermes',
            path.join(os.homedir(), '.cargo', 'bin', 'hermes')
        ];

        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }

        try {
            const stdout = execSync('which hermes', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
            const firstLine = stdout.split(/\n/).find(line => line.trim().length > 0);
            if (firstLine && fs.existsSync(firstLine.trim())) {
                return firstLine.trim();
            }
        } catch {}

        return path.join(hermesHome, 'bin', 'hermes');
    }
}

/**
 * Resolves the Python executable to run helper scripts (hermesDb.py).
 * On macOS / Linux, 'python3' is required as 'python' is often not installed.
 * Also checks Hermes bundled virtual environments.
 */
export function getPythonExecutablePath(configuredPython?: string): string {
    if (configuredPython && configuredPython.trim() !== '') {
        const trimmed = configuredPython.trim();
        if (fs.existsSync(trimmed)) {
            return trimmed;
        }
    }

    const hermesHome = getHermesHome();

    if (process.platform === 'win32') {
        // 1. Hermes bundled python in tools folder
        const toolsDir = path.join(hermesHome, 'tools');
        if (fs.existsSync(toolsDir)) {
            try {
                const subdirs = fs.readdirSync(toolsDir);
                for (const sub of subdirs) {
                    if (sub.startsWith('python-')) {
                        const bundledExe = path.join(toolsDir, sub, 'python.exe');
                        if (fs.existsSync(bundledExe)) {
                            return bundledExe;
                        }
                    }
                }
            } catch {}
        }

        // 2. Check virtualenv in hermes-agent
        const venvPy = path.join(hermesHome, 'hermes-agent', '.venv', 'Scripts', 'python.exe');
        if (fs.existsSync(venvPy)) {
            return venvPy;
        }

        // 3. Fallback to system python
        return 'python';
    } else {
        // macOS & Linux
        const candidates = [
            path.join(hermesHome, 'hermes-agent', '.venv', 'bin', 'python3'),
            path.join(hermesHome, 'hermes-agent', '.venv', 'bin', 'python'),
            path.join(hermesHome, 'venv', 'bin', 'python3'),
            path.join(hermesHome, 'venv', 'bin', 'python'),
            '/opt/homebrew/bin/python3',
            '/usr/local/bin/python3',
            '/usr/bin/python3'
        ];

        for (const candidate of candidates) {
            if (fs.existsSync(candidate)) {
                return candidate;
            }
        }

        const toolsDir = path.join(hermesHome, 'tools');
        if (fs.existsSync(toolsDir)) {
            try {
                const subdirs = fs.readdirSync(toolsDir);
                for (const sub of subdirs) {
                    if (sub.startsWith('python-')) {
                        const binPy = path.join(toolsDir, sub, 'bin', 'python3');
                        if (fs.existsSync(binPy)) {
                            return binPy;
                        }
                    }
                }
            } catch {}
        }

        try {
            const stdout = execSync('which python3', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
            const line = stdout.split(/\n/)[0]?.trim();
            if (line && fs.existsSync(line)) {
                return line;
            }
        } catch {}

        try {
            const stdout = execSync('which python', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
            const line = stdout.split(/\n/)[0]?.trim();
            if (line && fs.existsSync(line)) {
                return line;
            }
        } catch {}

        return 'python3';
    }
}

/**
 * Returns a guaranteed valid working directory for Hermes ACP child process.
 */
export function getHermesSafeCwd(configuredCwd?: string, workspaceCwd?: string): string {
    if (configuredCwd && configuredCwd.trim() !== '' && configuredCwd !== '${workspaceFolder}') {
        const resolved = path.resolve(configuredCwd.trim());
        if (fs.existsSync(resolved)) {
            return resolved;
        }
    }

    if (workspaceCwd && fs.existsSync(workspaceCwd)) {
        return workspaceCwd;
    }

    const hermesHome = getHermesHome();
    const agentDir = path.join(hermesHome, 'hermes-agent');
    if (fs.existsSync(agentDir)) {
        return agentDir;
    }

    if (fs.existsSync(hermesHome)) {
        return hermesHome;
    }

    return os.homedir();
}
