import * as fs from 'fs';
import * as path from 'path';
import type { Logger } from '../utils/logger';
import { getHermesHome } from '../utils/hermesPaths';

export interface SkillInfo {
    name: string;
    description: string;
    category: string;
    path: string;
    dirPath: string;
    isLearned?: boolean;
}

export class SkillService {
    private logger: Logger;

    constructor(logger: Logger) {
        this.logger = logger;
    }

    /**
     * Streams skills directly from disk on NVMe/SSD on-demand.
     * ZERO in-memory caching to avoid RAM bloat when thousands of skills exist.
     */
    public async getSkills(filterQuery?: string): Promise<SkillInfo[]> {
        const hermesHome = getHermesHome();
        const skillsDir = path.join(hermesHome, 'skills');

        if (!fs.existsSync(skillsDir)) {
            return [];
        }

        // 1. Read learned skills ledger if present
        const curatedSkills = new Set<string>();
        const ledgerFile = path.join(skillsDir, '.curator_ledger.jsonl');
        if (fs.existsSync(ledgerFile)) {
            try {
                const ledgerContent = await fs.promises.readFile(ledgerFile, 'utf8');
                for (const line of ledgerContent.split(/\r?\n/)) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    try {
                        const entry = JSON.parse(trimmed);
                        const sName = entry.skill_name || entry.name;
                        if (sName) {
                            curatedSkills.add(sName);
                        }
                    } catch {
                        // Ignore individual line JSON errors
                    }
                }
            } catch (err) {
                this.logger.debug('Error reading skills ledger:', err);
            }
        }

        const skills: SkillInfo[] = [];

        try {
            const catDirs = await fs.promises.readdir(skillsDir, { withFileTypes: true });
            for (const catDirent of catDirs) {
                if (!catDirent.isDirectory() || catDirent.name.startsWith('.')) continue;

                const category = catDirent.name;
                const catPath = path.join(skillsDir, category);

                let skillDirs: fs.Dirent[] = [];
                try {
                    skillDirs = await fs.promises.readdir(catPath, { withFileTypes: true });
                } catch {
                    continue;
                }

                for (const sDirent of skillDirs) {
                    if (!sDirent.isDirectory() || sDirent.name.startsWith('.')) continue;

                    const skillName = sDirent.name;
                    const sDirPath = path.join(catPath, skillName);
                    const skillFile = path.join(sDirPath, 'SKILL.md');

                    if (fs.existsSync(skillFile)) {
                        const description = await this.extractSkillDescription(skillFile);
                        const isLearned = curatedSkills.has(skillName);

                        if (filterQuery) {
                            const q = filterQuery.toLowerCase();
                            if (!skillName.toLowerCase().includes(q) &&
                                !category.toLowerCase().includes(q) &&
                                !(description && description.toLowerCase().includes(q))) {
                                continue;
                            }
                        }

                        skills.push({
                            name: skillName,
                            description: description || 'Hermes Skill',
                            category,
                            path: skillFile,
                            dirPath: sDirPath,
                            isLearned
                        });
                    }
                }
            }

            // Sort: Learned first, then category, then name
            skills.sort((a, b) => {
                if (a.isLearned !== b.isLearned) {
                    return a.isLearned ? -1 : 1;
                }
                if (a.category !== b.category) {
                    return a.category.localeCompare(b.category);
                }
                return a.name.localeCompare(b.name);
            });

            return skills;
        } catch (error) {
            this.logger.error('Failed to list skills directly from disk:', error);
            return [];
        }
    }

    private async extractSkillDescription(skillFile: string): Promise<string | null> {
        try {
            const content = await fs.promises.readFile(skillFile, 'utf8');
            const lines = content.split(/\r?\n/);
            let inFrontmatter = false;

            for (const line of lines) {
                const t = line.trim();
                if (t === '---') {
                    if (!inFrontmatter) {
                        inFrontmatter = true;
                    } else {
                        break;
                    }
                    continue;
                }
                if (inFrontmatter && t.startsWith('description:')) {
                    let desc = t.slice('description:'.length).trim();
                    if ((desc.startsWith('"') && desc.endsWith('"')) || (desc.startsWith("'") && desc.endsWith("'"))) {
                        desc = desc.slice(1, -1);
                    }
                    return desc;
                }
            }
        } catch {
            // Ignore read errors
        }
        return null;
    }
}
