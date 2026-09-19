export class Logger {
    private prefix: string;
    private level: 'debug' | 'info' | 'warn' | 'error' = 'info';

    private levels = {
        debug: 0,
        info: 1,
        warn: 2,
        error: 3
    };

    constructor(prefix: string) {
        this.prefix = prefix;
    }

    setLevel(level: 'debug' | 'info' | 'warn' | 'error'): void {
        this.level = level;
    }

    private shouldLog(level: string): boolean {
        return this.levels[level as keyof typeof this.levels] >= this.levels[this.level];
    }

    private formatMessage(level: string, message: string, ...args: any[]): string {
        const timestamp = new Date().toISOString();
        const prefix = `[${timestamp}] [${level.toUpperCase()}] [${this.prefix}]`;
        
        if (args.length > 0) {
            const formattedArgs = args.map(arg => {
                if (arg instanceof Error) {
                    return `${arg.name}: ${arg.message}\n${arg.stack}`;
                }
                return typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg);
            }).join(' ');
            return `${prefix} ${message} ${formattedArgs}`;
        }
        return `${prefix} ${message}`;
    }

    debug(message: string, ...args: any[]): void {
        if (this.shouldLog('debug')) {
            console.debug(this.formatMessage('debug', message, ...args));
        }
    }

    info(message: string, ...args: any[]): void {
        if (this.shouldLog('info')) {
            console.info(this.formatMessage('info', message, ...args));
        }
    }

    warn(message: string, ...args: any[]): void {
        if (this.shouldLog('warn')) {
            console.warn(this.formatMessage('warn', message, ...args));
        }
    }

    error(message: string, ...args: any[]): void {
        if (this.shouldLog('error')) {
            console.error(this.formatMessage('error', message, ...args));
        }
    }
}