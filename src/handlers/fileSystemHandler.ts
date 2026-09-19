import * as vscode from 'vscode';
import { Logger } from '../utils/logger';

export class FileSystemHandler {
    private logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger;
    }

    async handleToolCall(toolCall: any): Promise<void> {
        const { name, args, kind } = toolCall;

        switch (kind) {
            case 'read':
                await this.handleRead(args);
                break;
            case 'write':
            case 'create':
                await this.handleWrite(args);
                break;
            case 'edit':
            case 'patch':
                await this.handleEdit(args);
                break;
            case 'delete':
                await this.handleDelete(args);
                break;
            case 'search':
                await this.handleSearch(args);
                break;
        }
    }

    private async handleRead(args: any): Promise<void> {
        const filePath = args.path || args.filePath;
        if (!filePath) return;

        try {
            const uri = vscode.Uri.file(filePath);
            const document = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(document, { preview: true });
        } catch (error) {
            this.logger.error('Failed to open file for reading', error);
        }
    }

    private async handleWrite(args: any): Promise<void> {
        const filePath = args.path || args.filePath;
        const content = args.content || args.text;
        if (!filePath) return;

        try {
            const uri = vscode.Uri.file(filePath);
            const encoder = new TextEncoder();
            await vscode.workspace.fs.writeFile(uri, encoder.encode(content));
            
            const document = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(document);
        } catch (error) {
            this.logger.error('Failed to write file', error);
        }
    }

    private async handleEdit(args: any): Promise<void> {
        const filePath = args.path || args.filePath;
        if (!filePath) return;

        try {
            const uri = vscode.Uri.file(filePath);
            const document = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(document);

            // Apply edits if provided
            if (args.edits && Array.isArray(args.edits)) {
                await editor.edit(editBuilder => {
                    for (const edit of args.edits) {
                        const range = new vscode.Range(
                            edit.startLine - 1, edit.startColumn - 1,
                            edit.endLine - 1, edit.endColumn - 1
                        );
                        editBuilder.replace(range, edit.newText);
                    }
                });
            } else if (args.oldString && args.newString) {
                await editor.edit(editBuilder => {
                    const text = document.getText();
                    const index = text.indexOf(args.oldString);
                    if (index >= 0) {
                        const start = document.positionAt(index);
                        const end = document.positionAt(index + args.oldString.length);
                        editBuilder.replace(new vscode.Range(start, end), args.newString);
                    }
                });
            }
        } catch (error) {
            this.logger.error('Failed to edit file', error);
        }
    }

    private async handleDelete(args: any): Promise<void> {
        const filePath = args.path || args.filePath;
        if (!filePath) return;

        try {
            const uri = vscode.Uri.file(filePath);
            await vscode.workspace.fs.delete(uri);
        } catch (error) {
            this.logger.error('Failed to delete file', error);
        }
    }

    private async handleSearch(args: any): Promise<void> {
        const pattern = args.pattern || args.query;
        if (!pattern) return;

        try {
            await vscode.commands.executeCommand('workbench.action.findInFiles', {
                query: pattern,
                triggerSearch: true
            });
        } catch (error) {
            this.logger.error('Failed to search files', error);
        }
    }

    async readFile(filePath: string): Promise<string | null> {
        try {
            const uri = vscode.Uri.file(filePath);
            const content = await vscode.workspace.fs.readFile(uri);
            return new TextDecoder().decode(content);
        } catch (error) {
            this.logger.error('Failed to read file', error);
            return null;
        }
    }

    async writeFile(filePath: string, content: string): Promise<boolean> {
        try {
            const uri = vscode.Uri.file(filePath);
            const encoder = new TextEncoder();
            await vscode.workspace.fs.writeFile(uri, encoder.encode(content));
            return true;
        } catch (error) {
            this.logger.error('Failed to write file', error);
            return false;
        }
    }

    async listFiles(dirPath: string): Promise<string[]> {
        try {
            const uri = vscode.Uri.file(dirPath);
            const entries = await vscode.workspace.fs.readDirectory(uri);
            return entries.map(([name, type]) => name);
        } catch (error) {
            this.logger.error('Failed to list files', error);
            return [];
        }
    }
}