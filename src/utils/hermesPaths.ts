import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { execSync } from 'child_process';

/**
 * Resolves the Hermes home directory across Windows, macOS, and Linux.
 * Follows Hermes Agent's internal `get_hermes_home()` convention:
 * - On Windows: %LOCALAPPDATA%\hermes (with fallback to %USERPROFILE%\AppData\Local\hermes or %USERPROFILE%\.hermes)
 * - On POSIX: ~/.hermes
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
        // Windows platform default is LOCALAPPDATA\hermes
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

        // Default fallback on Windows
        return localAppData ? path.join(localAppData, 'hermes') : appDataHermes;
    } else {
        // macOS / Linux default
        const home = process.env.HOME || os.homedir();
        return path.join(home, '.hermes');
    }
}

/**
 * Locates the executable for Hermes CLI.
 * Checks in:
 * 1. Specific command passed in settings (if valid and not generic 'hermes')
 * 2. <hermesHome>\bin\hermes.cmd or hermes.exe (Windows)
 * 3. <hermesHome>\bin\hermes or ~/.local/bin/hermes (POSIX)
 * 4. System PATH via where / which
 * 5. Fallback 'hermes'
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

        // Try 'where.exe hermes'
        try {
            const stdout = execSync('where.exe hermes', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
            const firstLine = stdout.split(/\r?\n/).find(line => line.trim().length > 0 && fs.existsSync(line.trim()));
            if (firstLine) {
                return firstLine.trim();
            }
        } catch {
            // where.exe not found or failed
        }

        return binCmd;
    } else {
        const binPath = path.join(hermesHome, 'bin', 'hermes');
        if (fs.existsSync(binPath)) {
            return binPath;
        }

        const localBin = path.join(os.homedir(), '.local', 'bin', 'hermes');
        if (fs.existsSync(localBin)) {
            return localBin;
        }

        try {
            const stdout = execSync('which hermes', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
            const firstLine = stdout.split(/\n/).find(line => line.trim().length > 0);
            if (firstLine && fs.existsSync(firstLine.trim())) {
                return firstLine.trim();
            }
        } catch {
            // which failed
        }

        return 'hermes';
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
