import * as vscode from 'vscode';
import type { Logger } from '../utils/logger';
import { HermesDatabase, type SkillInfo } from '../config/hermesConfig';

type SkillTreeElement = SkillCategoryItem | SkillItem;

export class SkillsViewProvider implements vscode.TreeDataProvider<SkillTreeElement> {
    private logger: Logger;
    private hermesDb: HermesDatabase;
    private skills: SkillInfo[] = [];
    private isLoading = false;
    private onDidChangeTreeDataEmitter = new vscode.EventEmitter<SkillTreeElement | undefined | null | void>();
    readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

    constructor(private context: vscode.ExtensionContext, logger: Logger) {
        this.logger = logger;
        this.hermesDb = new HermesDatabase(logger);
    }

    refresh(): void {
        this.onDidChangeTreeDataEmitter.fire();
    }

    async loadSkills(_customSkillsPath?: string): Promise<SkillInfo[]> {
        if (this.isLoading) return this.skills;
        this.isLoading = true;
        try {
            const skills = await this.hermesDb.getSkills();
            this.skills = skills;
        } catch (error) {
            this.logger.error('Failed to load skills', error);
        } finally {
            this.isLoading = false;
            this.refresh();
        }
        return this.skills;
    }

    getTreeItem(element: SkillTreeElement): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: SkillTreeElement): Promise<SkillTreeElement[]> {
        if (this.skills.length === 0 && !this.isLoading) {
            await this.loadSkills();
        }

        if (!element) {
            if (this.skills.length === 0) {
                const empty = new vscode.TreeItem('No skills found');
                empty.description = 'Skills will appear as Hermes installs or creates them';
                empty.iconPath = new vscode.ThemeIcon('info');
                return [empty as any];
            }

            const items: SkillTreeElement[] = [];

            // 1. Learned / Custom skills section at top
            const learned = this.skills.filter(s => s.isLearned);
            if (learned.length > 0) {
                items.push(new SkillCategoryItem('Learned & Custom Skills', learned, true));
            }

            // 2. Group standard skills by category
            const categories = new Map<string, SkillInfo[]>();
            for (const skill of this.skills) {
                if (skill.isLearned) continue; // already in learned section
                const cat = skill.category || 'other';
                if (!categories.has(cat)) {
                    categories.set(cat, []);
                }
                categories.get(cat)!.push(skill);
            }

            for (const [catName, catSkills] of categories.entries()) {
                items.push(new SkillCategoryItem(formatCategoryName(catName), catSkills, false));
            }

            return items;
        }

        if (element instanceof SkillCategoryItem) {
            return element.skills.map(s => new SkillItem(s));
        }

        return [];
    }

    getParent(_element: SkillTreeElement): vscode.ProviderResult<SkillTreeElement> {
        return null;
    }
}

class SkillCategoryItem extends vscode.TreeItem {
    public readonly skills: SkillInfo[];

    constructor(title: string, skills: SkillInfo[], isLearned: boolean) {
        super(
            title,
            isLearned ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
        );
        this.skills = skills;
        this.description = `(${skills.length})`;
        this.contextValue = isLearned ? 'learnedSkillsCategory' : 'skillCategory';
        this.iconPath = isLearned ? new vscode.ThemeIcon('sparkle') : new vscode.ThemeIcon('folder');
    }
}

class SkillItem extends vscode.TreeItem {
    constructor(public readonly skill: SkillInfo) {
        super(skill.name, vscode.TreeItemCollapsibleState.None);

        this.description = skill.description;
        this.tooltip = new vscode.MarkdownString(
            `### ⚡ ${skill.name} ${skill.isLearned ? '*(Learned by Hermes)*' : ''}\n\n` +
            `${skill.description}\n\n` +
            `- **Category:** \`${skill.category}\`\n` +
            `- **File:** \`${skill.path}\`\n\n` +
            `*Click to open and edit SKILL.md in VS Code.*`
        );
        this.contextValue = 'skill';
        this.iconPath = skill.isLearned ? new vscode.ThemeIcon('star-full') : new vscode.ThemeIcon('symbol-method');

        this.command = {
            command: 'hermes.openSkillFile',
            title: 'Open Skill File',
            arguments: [skill.path]
        };
    }
}

function formatCategoryName(slug: string): string {
    return slug
        .split('-')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
}
