import * as vscode from 'vscode';
import type { Logger } from '../utils/logger';

export interface ACPPermissionOption {
    optionId: string;
    kind: string;
    name: string;
}

export interface PermissionRequest {
    id?: number | string;
    sessionId: string;
    requestId?: string;
    toolCall: {
        id?: string;
        toolCallId?: string;
        name?: string;
        args?: any;
        kind?: string;
        title?: string;
        content?: any[];
        rawInput?: any;
    };
    options: Array<ACPPermissionOption | string>;
}

export class PermissionHandler {
    private logger: Logger;
    private autoApprove = false;
    private pendingRequests = new Map<string, PermissionRequest>();

    constructor(logger: Logger) {
        this.logger = logger;
    }

    setAutoApprove(enabled: boolean): void {
        this.autoApprove = enabled;
        this.logger.info(`Auto-approve ${enabled ? 'enabled' : 'disabled'}`);
    }

    isAutoApprove(): boolean {
        return this.autoApprove || vscode.workspace.getConfiguration('hermes').get<boolean>('autoApprovePermissions', false);
    }

    async handleRequest(request: PermissionRequest): Promise<string> {
        const reqKey = String(request.requestId || request.id || `perm-${Date.now()}`);
        this.pendingRequests.set(reqKey, request);

        if (this.isAutoApprove()) {
            this.logger.info('Auto-approving permission request', reqKey);
            this.pendingRequests.delete(reqKey);

            if (request.options && request.options.length > 0) {
                const first = request.options[0];
                if (typeof first === 'string') {
                    const allowStr = (request.options as string[]).find(o => o.toLowerCase().includes('allow')) || first;
                    return allowStr;
                } else {
                    const allowOpt = (request.options as ACPPermissionOption[]).find(o =>
                        (o.kind && o.kind.startsWith('allow')) ||
                        (o.optionId && o.optionId.startsWith('allow'))
                    ) || request.options[0];
                    return (allowOpt as ACPPermissionOption).optionId || 'allow_once';
                }
            }
            return 'allow_once';
        }

        const toolCall = request.toolCall || ({} as any);
        const title = toolCall.title || toolCall.name || toolCall.kind || 'Tool Operation';
        const message = `Hermes Agent Permission: ${title}`;
        const detail = this.formatToolCallDetail(toolCall);

        const buttons: Array<{ title: string; value: string }> = (request.options || []).map((opt: any) => {
            if (typeof opt === 'string') {
                return {
                    title: opt.charAt(0).toUpperCase() + opt.slice(1).replace(/_/g, ' '),
                    value: opt
                };
            }
            return {
                title: opt.name || opt.title || (opt.optionId ? opt.optionId.charAt(0).toUpperCase() + opt.optionId.slice(1).replace(/_/g, ' ') : 'Allow'),
                value: opt.optionId || opt.id || 'allow_once'
            };
        });

        if (buttons.length === 0) {
            buttons.push(
                { title: 'Allow', value: 'allow_once' },
                { title: 'Deny', value: 'deny' }
            );
        }

        const selectedTitle = await vscode.window.showInformationMessage(
            message,
            { detail, modal: false },
            ...buttons.map(b => b.title)
        );

        this.pendingRequests.delete(reqKey);
        const chosen = buttons.find(b => b.title === selectedTitle);
        return chosen ? chosen.value : 'deny';
    }

    private formatToolCallDetail(toolCall: any): string {
        const parts: string[] = [];

        if (toolCall.title) {
            parts.push(`Action: ${toolCall.title}`);
        } else if (toolCall.name) {
            parts.push(`Tool: ${toolCall.name} (${toolCall.kind || 'tool'})`);
        }

        const raw = toolCall.rawInput || toolCall.raw_input || toolCall.args;
        if (raw) {
            if (raw.tool) {
                parts.push(`Tool: ${raw.tool}`);
            }
            if (raw.arguments?.path) {
                parts.push(`Target: ${raw.arguments.path}`);
            } else if (raw.path) {
                parts.push(`Target: ${raw.path}`);
            }
            if (raw.command) {
                parts.push(`Command: ${raw.command}`);
            }
        }

        return parts.join('\n');
    }

    getPendingRequests(): PermissionRequest[] {
        return Array.from(this.pendingRequests.values());
    }

    cancelRequest(requestId: string): void {
        this.pendingRequests.delete(requestId);
    }

    clear(): void {
        this.pendingRequests.clear();
    }
}
