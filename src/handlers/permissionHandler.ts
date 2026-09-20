import * as vscode from 'vscode';
import { Logger } from '../utils/logger';

interface PermissionRequest {
    sessionId: string;
    requestId: string;
    toolCall: {
        name: string;
        args: any;
        kind: string;
        title?: string;
    };
    options: string[];
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

    async handleRequest(request: PermissionRequest): Promise<string> {
        this.pendingRequests.set(request.requestId, request);

        if (this.autoApprove) {
            this.logger.info('Auto-approving permission request', request.requestId);
            this.pendingRequests.delete(request.requestId);
            return 'allow';
        }

        const toolCall = request.toolCall;
        const message = `Allow ${toolCall.kind} operation: ${toolCall.name}?`;
        const detail = this.formatToolCallDetail(toolCall);

        const buttons = request.options.map(opt => ({
            title: opt.charAt(0).toUpperCase() + opt.slice(1),
            value: opt
        }));

        const selected = await vscode.window.showInformationMessage(message, { detail, modal: true }, ...buttons);
        this.pendingRequests.delete(request.requestId);
        return selected?.value || 'deny';
    }

    private formatToolCallDetail(toolCall: any): string {
        let detail = `**Tool:** ${toolCall.name}\n**Kind:** ${toolCall.kind}\n`;
        
        if (toolCall.title) {
            detail += `**Title:** ${toolCall.title}\n`;
        }

        try {
            detail += `**Arguments:**\n\`\`\`json\n${JSON.stringify(toolCall.args, null, 2)}\n\`\`\``;
        } catch {
            detail += `**Arguments:** ${String(toolCall.args)}`;
        }

        return detail;
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