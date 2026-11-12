<script>
    import {
        modelConfigStore,
        selectedProviderId,
        selectedModelId,
        customModelId,
        isCustomModel,
        apiKeyInput,
        isKeyVisible,
        baseUrlInput,
        applyModelConfig
    } from '../../state/modelStore';
    import { postToHost, autoApproveSetting, cwdSetting, agentActivity, showToast } from '../../state/uiStore';
    import { locale, t } from '../../i18n';

    let modelFilter = 'all';
    let isReconnecting = false;

    $: current = $modelConfigStore?.current || { provider: 'openrouter', model: '', baseUrl: '' };
    $: providers = $modelConfigStore?.providers || [];
    $: activeProvider = providers.find((p) => p.id === $selectedProviderId) || providers[0];

    $: availableModels = (activeProvider?.models || []).filter((m) => {
        if (modelFilter === 'all') return true;
        if (modelFilter === 'free') return m.tag.toLowerCase().includes('free');
        if (modelFilter === 'top') return m.tag.toLowerCase().includes('top') || m.tag.toLowerCase().includes('recommended');
        if (modelFilter === 'fast') return m.tag.toLowerCase().includes('fast');
        return true;
    });

    // Sync selected provider when modelConfig loads
    $: if (current.provider && !$selectedModelId) {
        $selectedProviderId = current.provider;
        $selectedModelId = current.model;
        $baseUrlInput = current.baseUrl || '';
    }

    function handleProviderChange(e) {
        const target = e.target;
        $selectedProviderId = target.value;
        const prov = providers.find((p) => p.id === target.value);
        if (prov && prov.models.length > 0) {
            $selectedModelId = prov.models[0]?.id || '';
        }
        $apiKeyInput = '';
    }

    function handleSaveConfig() {
        const finalModel = $isCustomModel ? $customModelId.trim() : $selectedModelId;
        if (!finalModel) {
            showToast('Please select or enter a model name');
            return;
        }
        applyModelConfig($selectedProviderId, finalModel, $apiKeyInput, $baseUrlInput);
    }

    function handleReconnect() {
        if (isReconnecting) return;
        isReconnecting = true;
        $agentActivity = {
            state: 'tool',
            label: 'Connecting...',
            detail: 'Hermes ACP'
        };
        postToHost({ type: 'reconnect' });
        showToast(t('settings.reconnecting'));
        setTimeout(() => {
            isReconnecting = false;
        }, 2500);
    }

    function handleRunSetup() {
        postToHost({ type: 'runSetupTerminal' });
        showToast('Launched "hermes setup" in terminal');
    }

    function toggleAutoApprove() {
        const next = !$autoApproveSetting;
        $autoApproveSetting = next;
        postToHost({ type: 'updateSetting', key: 'autoApprovePermissions', value: next });
        showToast(next ? 'Auto-Approve Enabled' : 'Auto-Approve Disabled');
    }

    function toggleLanguage() {
        $locale = $locale === 'fa' ? 'en' : 'fa';
    }
</script>

<div class="panel-container models-panel">
    <div class="panel-header">
        <h3>{t('models.title')}</h3>
        <p class="panel-desc">{t('models.desc')}</p>
    </div>

    <!-- Active Model Card -->
    <div class="active-model-card obsidian-card">
        <div class="card-tag">{t('models.activeTag')}</div>
        <div class="active-model-title">
            {current.model ? current.model.split('/').pop()?.replace(/:free$/i, '') : 'None Selected'}
        </div>
        <div class="active-model-provider">
            {t('models.operatorLabel')} {current.provider.toUpperCase()}
        </div>
        <div class="active-model-status">✓ Ready</div>
    </div>

    <!-- Configuration Form -->
    <div class="config-form-card obsidian-card">
        <h4>{t('models.title')}</h4>

        <!-- Step 1: Provider / Operator -->
        <div class="form-group">
            <label for="select-provider">{t('models.operatorLabel')}</label>
            <select 
                id="select-provider" 
                class="form-select" 
                value={$selectedProviderId} 
                on:change={handleProviderChange}
            >
                {#each providers as prov (prov.id)}
                    <option value={prov.id}>{prov.name}</option>
                {/each}
            </select>
        </div>

        <!-- Step 2: API Key -->
        <div class="form-group">
            <div class="label-row">
                <label for="input-api-key">{t('models.apiKeyLabel')}</label>
                <span class="key-status-tag">
                    {activeProvider?.hasKey ? `✓ Key set (${activeProvider.keyMasked})` : '⚠️ No key set'}
                </span>
            </div>
            <div class="input-with-button">
                {#if $isKeyVisible}
                    <input 
                        type="text" 
                        id="input-api-key" 
                        bind:value={$apiKeyInput}
                        class="form-input" 
                        placeholder="Enter API Key (leave empty to keep existing)"
                    />
                {:else}
                    <input 
                        type="password" 
                        id="input-api-key" 
                        bind:value={$apiKeyInput}
                        class="form-input" 
                        placeholder="Enter API Key (leave empty to keep existing)"
                    />
                {/if}
                <button 
                    type="button" 
                    class="btn-toggle" 
                    on:click={() => $isKeyVisible = !$isKeyVisible}
                    title="Show/Hide Key"
                >
                    {$isKeyVisible ? '🙈' : '👁️'}
                </button>
            </div>
            <span class="form-help">{t('models.apiKeySaved')}</span>
        </div>

        <!-- Base URL (Optional) -->
        <div class="form-group">
            <label for="input-base-url"><span dir="ltr">Base URL (Optional):</span></label>
            <input 
                type="text" 
                id="input-base-url" 
                bind:value={$baseUrlInput} 
                class="form-input" 
                placeholder="https://api.example.com/v1"
            />
        </div>

        <!-- Step 3: Model Selection -->
        <div class="form-group">
            <div class="label-row">
                <label for="select-model">{t('models.modelLabel')}</label>
                <span class="model-count-label">({availableModels.length} models)</span>
            </div>

            <div class="filter-chips">
                <button 
                    type="button" 
                    class="chip {modelFilter === 'all' ? 'active' : ''}" 
                    on:click={() => modelFilter = 'all'}
                >All</button>
                <button 
                    type="button" 
                    class="chip {modelFilter === 'free' ? 'active' : ''}" 
                    on:click={() => modelFilter = 'free'}
                >Free Tier</button>
                <button 
                    type="button" 
                    class="chip {modelFilter === 'top' ? 'active' : ''}" 
                    on:click={() => modelFilter = 'top'}
                >Top Rated</button>
                <button 
                    type="button" 
                    class="chip {modelFilter === 'fast' ? 'active' : ''}" 
                    on:click={() => modelFilter = 'fast'}
                >Fast</button>
            </div>

            {#if !$isCustomModel}
                <select 
                    id="select-model" 
                    class="form-select" 
                    bind:value={$selectedModelId}
                >
                    {#each availableModels as m (m.id)}
                        <option value={m.id}>
                            [{m.tag}] {m.name}
                        </option>
                    {/each}
                </select>
            {/if}

            <div class="custom-model-toggle">
                <label class="checkbox-label">
                    <input type="checkbox" bind:checked={$isCustomModel}> {t('models.customCheck')}
                </label>
                {#if $isCustomModel}
                    <input 
                        type="text" 
                        bind:value={$customModelId} 
                        class="form-input" 
                        placeholder="e.g. nvidia/nemotron-3-ultra-550b-a55b:free" 
                        style="margin-top: 6px;"
                    />
                {/if}
            </div>
        </div>

        <div class="form-actions">
            <button type="button" class="btn-apply-config" on:click={handleSaveConfig}>
                🚀 {t('models.applyBtn')}
            </button>
        </div>
    </div>

    <!-- Integrated Settings & Recovery Card -->
    <div class="settings-card obsidian-card" style="margin-top: 20px;">
        <div class="card-section-header">
            <span class="section-icon">⚙️</span>
            <div class="section-title-wrap">
                <span class="section-title">{t('settings.title')}</span>
                <p class="section-desc">{t('settings.desc')}</p>
            </div>
        </div>

        <div class="setting-actions-grid" style="margin-top: 12px;">
            <button 
                type="button" 
                class="btn-setting-action {isReconnecting ? 'action-loading' : ''}" 
                on:click={handleReconnect}
                disabled={isReconnecting}
            >
                <span class="btn-icon {isReconnecting ? 'spinning' : ''}">↻</span>
                <div class="btn-text-wrap">
                    <span class="btn-main-label">
                        {isReconnecting ? t('settings.reconnecting') : t('models.reconnectBtn')}
                    </span>
                    <span class="btn-sub-label">بازیابی سریع اتصال با کلاینت محلی</span>
                </div>
            </button>

            <button type="button" class="btn-setting-action" on:click={handleRunSetup}>
                <span class="btn-icon">⚙️</span>
                <div class="btn-text-wrap">
                    <span class="btn-main-label">{t('models.terminalSetupBtn')}</span>
                    <span class="btn-sub-label">پیکربندی کلیدها در ترمینال</span>
                </div>
            </button>
        </div>

        <!-- Auto-Approve Permissions -->
        <div class="setting-row" style="margin-top: 14px; border-top: 1px solid var(--hermes-border); padding-top: 12px;">
            <div class="setting-info">
                <span class="setting-name">{t('models.autoApprove')}</span>
                <span class="setting-desc">{t('models.autoApproveDesc')}</span>
            </div>
            <label class="switch">
                <input type="checkbox" checked={$autoApproveSetting} on:change={toggleAutoApprove}>
                <span class="slider round"></span>
            </label>
        </div>

        <!-- Language Switcher Capsule -->
        <div class="setting-row" style="margin-top: 12px; border-top: 1px solid var(--hermes-border); padding-top: 12px;">
            <div class="setting-info">
                <span class="setting-name">{t('models.langLabel')}</span>
                <span class="setting-desc">تغییر جهت و زبان افزونه بین فارسی و انگلیسی</span>
            </div>
            <div class="lang-capsule-toggle">
                <button 
                    type="button" 
                    class="lang-pill {$locale === 'fa' ? 'active' : ''}" 
                    on:click={() => { if ($locale !== 'fa') toggleLanguage(); }}
                >
                    فارسی (RTL)
                </button>
                <button 
                    type="button" 
                    class="lang-pill {$locale === 'en' ? 'active' : ''}" 
                    on:click={() => { if ($locale !== 'en') toggleLanguage(); }}
                >
                    English (LTR)
                </button>
            </div>
        </div>

        <div class="env-info-list" style="margin-top: 12px;">
            <div class="env-info-item">
                <span class="env-info-key">Working Directory (CWD):</span>
                <code class="env-info-val">{$cwdSetting || 'Workspace Root'}</code>
            </div>
            <div class="env-info-item">
                <span class="env-info-key">Hermes Config File:</span>
                <code class="env-info-val">%LOCALAPPDATA%\hermes\config.yaml</code>
            </div>
        </div>
    </div>
</div>
