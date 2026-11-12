import { SkillService } from '../src/services/SkillService';
import { Logger } from '../src/utils/logger';

describe('SkillService', () => {
    let service: SkillService;
    let logger: Logger;

    beforeEach(() => {
        logger = new Logger('TestSkillService');
        service = new SkillService(logger);
    });

    it('should query skills without throwing', async () => {
        const skills = await service.getSkills();
        expect(Array.isArray(skills)).toBe(true);
    });

    it('should filter skills by query', async () => {
        const skills = await service.getSkills('nonexistent_skill_xyz_123');
        expect(skills.length).toBe(0);
    });
});
