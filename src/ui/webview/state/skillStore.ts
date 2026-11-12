import { writable } from 'svelte/store';
import type { SkillInfo } from '../types';
import { activeTab, postToHost } from './uiStore';
import { sendUserPrompt } from './chatStore';

export const skillsList = writable<SkillInfo[]>([]);
export const skillSearch = writable<string>('');

export function useSkill(skill: SkillInfo): void {
    activeTab.set('chat');
    // Prompt the agent with the skill instruction
    sendUserPrompt(`Use the skill "${skill.name}" from ${skill.category}: Please apply its instructions.`);
}

export function refreshSkills(): void {
    postToHost({ type: 'refreshData' });
}
