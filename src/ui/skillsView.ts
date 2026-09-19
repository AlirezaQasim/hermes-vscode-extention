import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/logger';

interface SkillInfo {
    name: string;
    description: string;
    path: string;
    category?: string;
}

export class SkillsViewProvider implements vscode.TreeDataProvider<SkillItem> {
    private logger: Logger;
    private skills: SkillInfo[] = [];
    private onDidChangeTreeDataEmitter = new vscode.EventEmitter<SkillItem | undefined | null | void>();
    readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

    constructor(private context: vscode.ExtensionContext, logger: Logger) {
        this.logger = logger;
    }

    refresh(): void {
        this.onDidChangeTreeDataEmitter.fire();
    }

    async loadSkills(skillsPath: string): Promise<SkillInfo[]> {
        const expandedPath = skillsPath.replace('~', process.env.HOME || process.env.USERPROFILE || '');
        
        if (!fs.existsSync(expandedPath)) {
            this.logger.warn(`Skills path does not exist: ${expandedPath}`);
            return [];
        }

        const skills: SkillInfo[] = [];
        
        try {
            const categories = fs.readdirSync(expandedPath, { withFileTypes: true })
                .filter(d => d.isDirectory())
                .map(d => d.name);

            for (const category of categories) {
                const categoryPath = path.join(expandedPath, category);
                const skillDirs = fs.readdirSync(categoryPath, { withFileTypes: true })
                    .filter(d => d.isDirectory())
                    .map(d => d.name);

                for (const skillName of skillDirs) {
                    const skillPath = path.join(categoryPath, skillName);
                    const skillFile = path.join(skillPath, 'SKILL.md');
                    
                    if (fs.existsSync(skillFile)) {
                        const content = fs.readFileSync(skillFile, 'utf8');
                        const description = this.extractDescription(content);
                        skills.push({
                            name: skillName,
                            description: description || 'No description',
                            path: skillPath,
                            category
                        });
                    }
                }
            }
        } catch (error) {
            this.logger.error('Failed to load skills', error);
        }

        this.skills = skills;
        this.refresh();
        return skills;
    }

    private extractDescription(content: string): string | null {
        const lines = content.split('\n');
        let inFrontmatter = false;
        let description = '';

        for (const line of lines) {
            if (line.trim() === '---') {
                if (!inFrontmatter) {
                    inFrontmatter = true;
                } else {
                    break;
                }
                continue;
            }

            if (inFrontmatter && line.startsWith('description:')) {
                description = line.substring('description:'.length).trim();
                if (description.startsWith('"') && description.endsWith('"')) {
                    description = description.slice(1, -1);
                }
                break;
            }
        }

        return description || null;
    }

    getTreeItem(element: SkillItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: SkillItem): Thenable<SkillItem[]> {
        if (!element) {
            // Group by category
            const categories = new Map<string, SkillInfo[]>();
            for (const skill of this.skills) {
                const cat = skill.category || 'Uncategorized';
                if (!categories.has(cat)) {
                    categories.set(cat, []);
                }
                categories.get(cat)!.push(skill);
            }

            const items: SkillItem[] = [];
            for (const [category, skills] of categories) {
                items.push(new CategoryItem(category, skills));
            }
            return Promise.resolve(items);
        }

        if (element instanceof CategoryItem) {
            return Promise.resolve(element.skills.map(s => new SkillItem(s)));
        }

        return Promise.resolve([]);
    }

    getParent(element: SkillItem): vscode.ProviderResult<SkillItem> {
        return null;
    }
}

class CategoryItem extends vscode.TreeItem {
    constructor(
        public readonly category: string,
        public readonly skills: SkillInfo[]
    ) {
        super(category, vscode.TreeItemCollapsibleState.Expanded);
        this.contextValue = 'skillCategory';
        this.iconPath = new vscode.ThemeIcon('folder');
    }
}

class SkillItem extends vscode.TreeItem {
    constructor(skill: SkillInfo) {
        super(skill.name, vscode.TreeItemCollapsibleState.None);
        this.tooltip = `${skill.name}\n${skill.description}\nCategory: ${skill.category}\nPath: ${skill.path}`;
        this.description = skill.description;
        this.contextValue = 'skill';
        this.command = {
            command: 'hermes.injectSkill',
            title: 'Inject Skill',
            arguments: [skill.name]
        };
        this.iconPath = new vscode.ThemeIcon('symbol-method');
    }
}