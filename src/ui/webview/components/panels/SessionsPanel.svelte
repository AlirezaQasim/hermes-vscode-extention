<script>
    import { sessionsList, sessionFilter, sessionSearch, loadSession, toggleArchiveSession, deleteSession } from '../../state/sessionStore';
    import { startNewSession } from '../../state/chatStore';
    import { activeTab, openModal, postToHost, showToast } from '../../state/uiStore';
    import { t } from '../../i18n';

    $: filteredSessions = $sessionsList.filter((s) => {
        // Tab filter
        if ($sessionFilter === 'active' && s.archived) return false;
        if ($sessionFilter === 'archived' && !s.archived) return false;

        // Search query
        if ($sessionSearch) {
            const q = $sessionSearch.toLowerCase();
            const matchTitle = (s.title || s.id).toLowerCase().includes(q);
            const matchModel = (s.model || '').toLowerCase().includes(q);
            return matchTitle || matchModel;
        }
        return true;
    });

    $: countActive = $sessionsList.filter((s) => !s.archived).length;
    $: countArchived = $sessionsList.filter((s) => s.archived).length;
    $: countAll = $sessionsList.length;

    let isRefreshing = false;

    function handleNewSession() {
        startNewSession();
        activeTab.set('chat');
        showToast(t('sessions.newStarted'));
    }

    function handleRefresh() {
        if (isRefreshing) return;
        isRefreshing = true;
        postToHost({ type: 'refreshData' });
        showToast(t('sessions.refreshed'));
        setTimeout(() => {
            isRefreshing = false;
        }, 800);
    }

    function promptDelete(session) {
        openModal({
            icon: '🗑️',
            title: t('modal.confirmTitle'),
            message: t('modal.deleteSession'),
            callout: session.title || session.id,
            confirmLabel: t('sessions.delete'),
            cancelLabel: t('modal.cancel'),
            onConfirm: () => {
                deleteSession(session.id);
            }
        });
    }

    function formatRelativeDate(timestamp) {
        try {
            if (!timestamp) return '';
            const dateVal = typeof timestamp === 'number' ? timestamp : new Date(timestamp).getTime();
            const diff = Date.now() - dateVal;
            const mins = Math.floor(diff / 60000);
            if (mins < 1) return t('time.justNow');
            if (mins < 60) return `${mins} ${t('time.minsAgo')}`;
            const hours = Math.floor(mins / 60);
            if (hours < 24) return `${hours} ${t('time.hoursAgo')}`;
            const days = Math.floor(hours / 24);
            return `${days} ${t('time.daysAgo')}`;
        } catch {
            return '';
        }
    }
</script>

<div class="panel-container sessions-panel">
    <div class="panel-header">
        <div class="panel-title-row">
            <h3>{t('sessions.title')}</h3>
            <div class="panel-actions">
                <button type="button" class="btn-panel-action" on:click={handleNewSession}>
                    <span class="btn-action-icon">＋</span>
                    <span>{t('sessions.new')}</span>
                </button>
                <button type="button" class="btn-panel-action" on:click={handleRefresh} disabled={isRefreshing}>
                    <span class="btn-action-icon {isRefreshing ? 'spinning' : ''}">↻</span>
                    <span>{t('sessions.refresh')}</span>
                </button>
            </div>
        </div>

        <div class="filter-pills-row" id="sessions-filter-pills">
            <button 
                type="button" 
                class="filter-pill {$sessionFilter === 'active' ? 'active' : ''}" 
                on:click={() => $sessionFilter = 'active'}
            >
                <span class="pill-icon">💬</span>
                <span>{t('sessions.filter.active')} ({countActive})</span>
            </button>
            <button 
                type="button" 
                class="filter-pill {$sessionFilter === 'archived' ? 'active' : ''}" 
                on:click={() => $sessionFilter = 'archived'}
            >
                <span class="pill-icon">📦</span>
                <span>{t('sessions.filter.archived')} ({countArchived})</span>
            </button>
            <button 
                type="button" 
                class="filter-pill {$sessionFilter === 'all' ? 'active' : ''}" 
                on:click={() => $sessionFilter = 'all'}
            >
                <span>{t('sessions.filter.all')} ({countAll})</span>
            </button>
        </div>

        <input 
            type="text" 
            bind:value={$sessionSearch} 
            class="search-input" 
            placeholder={t('sessions.search')}
        />
    </div>

    <div id="sessions-list" class="cards-list">
        {#if filteredSessions.length === 0}
            <div class="empty-state">
                <span class="empty-icon">📂</span>
                <p>
                    {#if $sessionFilter === 'archived'}
                        {t('sessions.emptyArchived')}
                    {:else}
                        {t('sessions.empty')}
                    {/if}
                </p>
            </div>
        {:else}
            {#each filteredSessions as session (session.id)}
                <div class="session-card {session.archived ? 'session-archived' : ''}" data-id={session.id}>
                    <div class="session-card-header">
                        <span class="card-title">{session.title || session.id}</span>
                        <span class="card-time">{formatRelativeDate(session.updatedAt || session.lastActive)}</span>
                    </div>

                    <div class="card-badges">
                        {#if session.model}
                            <span class="chip-tag chip-model">
                                {session.model.split('/').pop()?.replace(/:free$/i, '') || session.model}
                            </span>
                        {/if}
                        <span class="chip-tag chip-count">
                            💬 {session.messageCount || 0} {t('sessions.messagesCount')}
                        </span>
                        {#if session.archived}
                            <span class="chip-tag chip-archived-badge">📦 {t('sessions.filter.archived')}</span>
                        {/if}
                    </div>

                    <div class="card-footer">
                        {#if !session.archived}
                            <button 
                                type="button" 
                                class="btn-card-action btn-resume-session" 
                                on:click={() => loadSession(session.id)}
                            >
                                <span class="btn-action-icon">▶</span>
                                <span>{t('sessions.resume')}</span>
                            </button>
                            <button 
                                type="button" 
                                class="btn-card-action btn-archive-session" 
                                on:click={() => toggleArchiveSession(session.id, false)}
                            >
                                <span class="btn-action-icon">📦</span>
                                <span>{t('sessions.archive')}</span>
                            </button>
                        {:else}
                            <button 
                                type="button" 
                                class="btn-card-action btn-restore-session" 
                                on:click={() => toggleArchiveSession(session.id, true)}
                            >
                                <span class="btn-action-icon">📤</span>
                                <span>{t('sessions.unarchive')}</span>
                            </button>
                            <button 
                                type="button" 
                                class="btn-card-action btn-resume-session" 
                                on:click={() => loadSession(session.id)}
                            >
                                <span class="btn-action-icon">▶</span>
                                <span>{t('sessions.view')}</span>
                            </button>
                        {/if}

                        <button 
                            type="button" 
                            class="btn-card-action btn-delete-session" 
                            on:click={() => promptDelete(session)}
                        >
                            <span class="btn-action-icon">🗑️</span>
                            <span>{t('sessions.delete')}</span>
                        </button>
                    </div>
                </div>
            {/each}
        {/if}
    </div>
</div>
