<script>
    import { activeTab, isConnected, agentActivity, postToHost } from '../../state/uiStore';
    import { sessionsList } from '../../state/sessionStore';
    import { skillsList } from '../../state/skillStore';
    import { t } from '../../i18n';

    function setTab(tab) {
        $activeTab = tab;
        postToHost({ type: 'switchTab', tab });
    }

    function handleStatusClick() {
        if (!$isConnected) {
            postToHost({ type: 'reconnect' });
        } else {
            setTab('models');
        }
    }

    $: statusClass = $agentActivity.label === 'Connecting...'
        ? 'connecting'
        : !$isConnected
        ? 'disconnected'
        : $agentActivity.state === 'thinking'
        ? 'thinking'
        : $agentActivity.state === 'writing_skill'
        ? 'writing-skill'
        : $agentActivity.state === 'tool'
        ? 'running-tool'
        : $agentActivity.state === 'streaming'
        ? 'streaming'
        : 'connected';

    $: statusLabel = $agentActivity.label === 'Connecting...'
        ? 'Connecting...'
        : !$isConnected
        ? (t('status.disconnected') || 'Disconnected')
        : $agentActivity.state === 'thinking'
        ? 'Thinking...'
        : $agentActivity.state === 'writing_skill'
        ? ($agentActivity.detail ? `⚡ ${$agentActivity.detail}` : 'Writing Skill...')
        : $agentActivity.state === 'tool'
        ? ($agentActivity.label || 'Tool Executing')
        : $agentActivity.state === 'streaming'
        ? 'Responding...'
        : (t('status.connected') || 'Local CLI');
</script>

<header id="dashboard-navbar" class="hud-navbar">
    <button type="button" class="brand brand-btn" on:click={() => setTab('chat')} title="Hermes Home">
        <span class="brand-logo">⚚</span>
        <div class="brand-titles">
            <span class="brand-title">HERMES</span>
            <span class="brand-subtitle">LOCAL AGENT</span>
        </div>
    </button>

    <button 
        type="button"
        class="hud-status-pill {statusClass}" 
        id="hud-status-pill" 
        title={statusLabel}
        on:click={handleStatusClick}
    >
        {#if $agentActivity.state === 'writing_skill'}
            <span class="pulse-icon">⚡</span>
        {:else}
            <span class="pulse-dot"></span>
        {/if}
        <span class="status-label" id="hud-status-text">
            {statusLabel}
        </span>
    </button>

    <nav class="nav-tabs">
        <button 
            type="button"
            class="nav-tab {$activeTab === 'chat' ? 'active' : ''}" 
            on:click={() => setTab('chat')}
            title={t('tab.chat')}
        >
            <span class="nav-icon">💬</span>
            <span class="nav-text">{t('tab.chat')}</span>
        </button>

        <button 
            type="button"
            class="nav-tab {$activeTab === 'sessions' ? 'active' : ''}" 
            on:click={() => setTab('sessions')}
            title={t('tab.sessions')}
        >
            <span class="nav-icon">🕒</span>
            <span class="nav-badge" id="nav-sessions-count">{$sessionsList.length}</span>
        </button>

        <button 
            type="button"
            class="nav-tab {$activeTab === 'skills' ? 'active' : ''}" 
            on:click={() => setTab('skills')}
            title={t('tab.skills')}
        >
            <span class="nav-icon">⚡</span>
            <span class="nav-badge" id="nav-skills-count">{$skillsList.length}</span>
        </button>

        <button 
            type="button"
            class="nav-tab {$activeTab === 'models' || $activeTab === 'settings' ? 'active' : ''}" 
            on:click={() => setTab('models')}
            title={t('tab.models')}
        >
            <span class="nav-icon">⚙️</span>
        </button>
    </nav>
</header>
