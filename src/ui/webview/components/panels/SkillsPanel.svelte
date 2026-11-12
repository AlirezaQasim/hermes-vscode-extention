<script>
    import { skillsList, skillSearch, useSkill, refreshSkills } from '../../state/skillStore';
    import { postToHost, showToast } from '../../state/uiStore';
    import { t } from '../../i18n';

    let isRefreshing = false;

    $: filteredSkills = $skillsList.filter((s) => {
        if (!$skillSearch) return true;
        const q = $skillSearch.toLowerCase();
        return (
            (s.name && s.name.toLowerCase().includes(q)) ||
            (s.category && s.category.toLowerCase().includes(q)) ||
            (s.description && s.description.toLowerCase().includes(q))
        );
    });

    function handleRefreshSkills() {
        if (isRefreshing) return;
        isRefreshing = true;
        refreshSkills();
        showToast(t('skills.refreshed'));
        setTimeout(() => {
            isRefreshing = false;
        }, 800);
    }

    function handleOpenSkillFile(skillPath) {
        if (skillPath) {
            postToHost({ type: 'openSkillFile', skillPath });
        }
    }
</script>

<div class="panel-container skills-panel">
    <div class="panel-header">
        <div class="panel-title-row">
            <h3>{t('skills.title')}</h3>
            <div class="panel-actions">
                <button type="button" class="btn-panel-action" on:click={handleRefreshSkills} disabled={isRefreshing}>
                    <span class="btn-action-icon {isRefreshing ? 'spinning' : ''}">↻</span>
                    <span>{t('skills.refresh')}</span>
                </button>
            </div>
        </div>
        <p class="panel-desc">{t('skills.desc')}</p>
        <input 
            type="text" 
            bind:value={$skillSearch} 
            class="search-input" 
            placeholder={t('skills.search')}
        />
    </div>

    <div id="skills-list" class="cards-list">
        {#if filteredSkills.length === 0}
            <div class="empty-state">
                <span class="empty-icon">⚡</span>
                <p>{t('skills.empty')}</p>
            </div>
        {:else}
            {#each filteredSkills as skill (skill.path || skill.name)}
                <div class="skill-card" data-path={skill.path}>
                    <div class="skill-card-header">
                        <span class="card-title">⚡ {skill.name}</span>
                        <div class="card-badges">
                            {#if skill.isLearned}
                                <span class="chip-tag chip-learned">🌟 {t('skills.learned')}</span>
                            {/if}
                            {#if skill.category}
                                <span class="chip-tag chip-count">{skill.category}</span>
                            {/if}
                        </div>
                    </div>

                    <div class="card-desc" dir="ltr" style="text-align: left;">
                        {skill.description}
                    </div>

                    <div class="card-footer">
                        {#if skill.path}
                            <button 
                                type="button" 
                                class="btn-card-action btn-open-skill" 
                                on:click={() => handleOpenSkillFile(skill.path)}
                            >
                                <span class="btn-action-icon">📄</span>
                                <span>{t('skills.openFile')}</span>
                            </button>
                        {/if}
                        <button 
                            type="button" 
                            class="btn-card-action btn-use-skill" 
                            on:click={() => useSkill(skill)}
                        >
                            <span class="btn-action-icon">⚡</span>
                            <span>{t('skills.useInChat')}</span>
                        </button>
                    </div>
                </div>
            {/each}
        {/if}
    </div>
</div>
