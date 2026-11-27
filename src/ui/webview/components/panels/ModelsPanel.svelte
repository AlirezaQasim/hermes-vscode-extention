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
        selectedReasoningEffort,
        applyModelConfig,
        applyReasoningEffort
    } from '../../state/modelStore';
    import { postToHost, autoApproveSetting, cwdSetting, agentActivity, showToast } from '../../state/uiStore';
    import { locale, t } from '../../i18n';

    let modelFilter = 'all';
    let providerSearch = '';
    let isReconnecting = false;

    $: current = $modelConfigStore?.current || { provider: 'openrouter', model: '', baseUrl: '' };
    $: providers = $modelConfigStore?.providers || [];
    $: activeProvider = providers.find((p) => p.id === $selectedProviderId) || providers[0];
    $: filteredProviders = providers.filter((p) => {
        const q = providerSearch.trim().toLowerCase();
        if (!q) return true;
        return (p.id || '').toLowerCase().includes(q) || (p.name || '').toLowerCase().includes(q);
    });
    $: topProviders = filteredProviders.filter((p, idx) => (p.isTopPriority !== undefined ? p.isTopPriority : idx < 20));
    $: moreProviders = filteredProviders.filter((p, idx) => (p.isTopPriority !== undefined ? !p.isTopPriority : idx >= 20));

    function keyBadgeInfo(prov) {
        const st = prov?.keyStatus || (prov?.hasKey ? 'unverified' : 'missing');
        if (st === 'valid') return { cls: 'valid', text: '✓ معتبر' };
        if (st === 'invalid') return { cls: 'invalid', text: '✗ نامعتبر' };
        if (st === 'oauth') return { cls: 'oauth', text: '🔐 OAuth' };
        if (st === 'local') return { cls: 'local', text: '🖥️ محلی' };
        if (st === 'unverified') return { cls: 'unverified', text: '⚡ کلید ثبت' };
        if (st === 'offline') return { cls: 'offline', text: 'آفلاین' };
        return { cls: 'missing', text: 'بدون کلید' };
    }

    $: availableModels = (activeProvider?.models || []).filter((m) => {
        if (modelFilter === 'all') return true;
        if (modelFilter === 'free') return m.tag.toLowerCase().includes('free') || m.id.toLowerCase().includes(':free') || m.name.toLowerCase().includes('free');
        if (modelFilter === 'top') return m.tag.toLowerCase().includes('top') || m.tag.toLowerCase().includes('recommended');
        if (modelFilter === 'fast') return m.tag.toLowerCase().includes('fast');
        return true;
    });

    // Auto-select first available model if current selection is not in the filtered list
    $: if (availableModels.length > 0 && !availableModels.some(m => m.id === $selectedModelId)) {
        $selectedModelId = availableModels[0].id;
    }

    // Sync selected provider and reasoning effort when modelConfig loads
    $: if (current.provider && !$selectedModelId) {
        $selectedProviderId = current.provider;
        $selectedModelId = current.model;
        $baseUrlInput = current.baseUrl || '';
    }
    $: if (current.reasoningEffort && current.reasoningEffort !== $selectedReasoningEffort) {
        $selectedReasoningEffort = current.reasoningEffort;
    }

    function selectProviderById(pid) {
        $selectedProviderId = pid;
        const prov = providers.find((p) => p.id === pid);
        if (prov) {
            if (prov.models && prov.models.length > 0) {
                $selectedModelId = prov.models[0]?.id || '';
            } else {
                $selectedModelId = '';
            }
            if (pid === current.provider && current.baseUrl && !current.baseUrl.includes('openrouter.ai')) {
                $baseUrlInput = current.baseUrl;
            } else {
                $baseUrlInput = prov.baseUrl || '';
            }
        }
        $apiKeyInput = '';
    }

    function handleProviderChange(e) {
        selectProviderById(e.target.value);
    }

    const effortLabels = {
        minimal: '1. minimal (حداقل تفکر - سریع‌ترین پاسخ)',
        low: '2. low (تفکر کوتاه - وظایف سبک و سریع)',
        medium: '3. medium (استدلال متعادل)',
        high: '4. high (استدلال عمیق و استاندارد - توصیه شده)',
        xhigh: '5. xhigh (استدلال بسیار عمیق برای تحلیل پیچیده)',
        max: '6. max (حداکثر توان استدلال مدل)',
        ultra: '7. ultra (استدلال بی‌نهایت - سخت‌ترین الگوریتم‌ها)'
    };

    $: activeModelObj = activeProvider?.models?.find((m) => m.id === $selectedModelId);
    $: isReasoningSupported = activeModelObj ? (activeModelObj.reasoning !== false) : true;
    $: isReasoningMandatory = activeModelObj?.reasoningMandatory === true;
    $: rawEfforts = activeModelObj?.reasoningEfforts && activeModelObj.reasoningEfforts.length > 0 
        ? activeModelObj.reasoningEfforts 
        : ['minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'];

    function handleReasoningEffortChange(e) {
        const val = e.target.value;
        $selectedReasoningEffort = val;
        applyReasoningEffort(val);
    }

    function handleSaveConfig() {
        const finalModel = $isCustomModel ? $customModelId.trim() : $selectedModelId;
        if (!finalModel) {
            showToast('Please select or enter a model name');
            return;
        }
        applyModelConfig($selectedProviderId, finalModel, $apiKeyInput, $baseUrlInput, $selectedReasoningEffort);
        $apiKeyInput = '';
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

    function handleRefreshModels() {
        postToHost({ type: 'syncCatalog', forceRefresh: true });
        showToast('🔄 در حال همگام‌سازی زنده اپراتورها، مدل‌ها و کلیدهای API...');
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
            {t('models.operatorLabel')} {current.provider.toUpperCase()} · 🧠 استدلال: {current.reasoningEffort || $selectedReasoningEffort || 'high'}
        </div>
        <div class="active-model-status">✓ Ready</div>
    </div>

    <!-- Configuration Form -->
    <div class="config-form-card obsidian-card">
        <h4>{t('models.title')}</h4>

        <!-- Step 1: Provider / Operator (Top 20 Prioritized + Scrollable Catalog) -->
        <div class="form-group">
            <div class="label-row">
                <label for="provider-search-input">{t('models.operatorLabel')}</label>
                <span class="model-count-label">({providers.length} اپراتور)</span>
            </div>
            <div class="provider-picker-shell">
                <div class="provider-picker-topbar">
                    <input
                        id="provider-search-input"
                        type="text"
                        class="provider-search-input"
                        bind:value={providerSearch}
                        placeholder={t('models.searchProviders')}
                    />
                    <button
                        type="button"
                        class="btn-live-sync"
                        on:click={handleRefreshModels}
                        title={t('sync.refreshBtn')}
                    >🔄 بروزرسانی</button>
                </div>
                <div class="provider-scroll-list" id="select-provider" role="listbox" aria-label={t('models.operatorLabel')}>
                    {#if topProviders.length > 0}
                        <div class="provider-section-divider">
                            <span>★ {t('models.topOperators')}</span>
                            <span>{topProviders.length}</span>
                        </div>
                        {#each topProviders as prov (prov.id)}
                            {@const badge = keyBadgeInfo(prov)}
                            <button
                                type="button"
                                class="provider-option-row {$selectedProviderId === prov.id ? 'active' : ''}"
                                on:click={() => selectProviderById(prov.id)}
                            >
                                <div class="provider-row-main">
                                    <span class="provider-row-title">#{prov.rank || '•'} {prov.name}</span>
                                    <span class="provider-row-meta">
                                        <span>{prov.id}</span>
                                        <span>· {prov.models?.length || 0} مدل</span>
                                        {#if prov.usageCount > 0}
                                            <span>· {prov.usageCount} نشست</span>
                                        {/if}
                                    </span>
                                </div>
                                <div class="provider-row-badges">
                                    <span class="key-badge {badge.cls}">{badge.text}</span>
                                </div>
                            </button>
                        {/each}
                    {/if}
                    {#if moreProviders.length > 0}
                        <div class="provider-section-divider">
                            <span>↓ {t('models.moreOperators')}</span>
                            <span>{moreProviders.length}</span>
                        </div>
                        {#each moreProviders as prov (prov.id)}
                            {@const badge = keyBadgeInfo(prov)}
                            <button
                                type="button"
                                class="provider-option-row {$selectedProviderId === prov.id ? 'active' : ''}"
                                on:click={() => selectProviderById(prov.id)}
                            >
                                <div class="provider-row-main">
                                    <span class="provider-row-title">#{prov.rank || '•'} {prov.name}</span>
                                    <span class="provider-row-meta">
                                        <span>{prov.id}</span>
                                        <span>· {prov.models?.length || 0} مدل</span>
                                    </span>
                                </div>
                                <div class="provider-row-badges">
                                    <span class="key-badge {badge.cls}">{badge.text}</span>
                                </div>
                            </button>
                        {/each}
                    {/if}
                </div>
            </div>
        </div>

        <!-- Step 2: API Key -->
        <div class="form-group">
            <div class="label-row">
                <label for="input-api-key">{t('models.apiKeyLabel')}</label>
                {#if activeProvider}
                    {@const activeBadge = keyBadgeInfo(activeProvider)}
                    <span class="key-badge {activeBadge.cls}">
                        {activeBadge.text} {activeProvider.keyMasked ? `(${activeProvider.keyMasked})` : ''} {activeProvider.keyDetail ? `— ${activeProvider.keyDetail}` : ''}
                    </span>
                {:else}
                    <span class="key-status-tag">⚠️ No key set</span>
                {/if}
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
                <div style="display: inline-flex; align-items: center; gap: 6px;">
                    <span class="model-count-label">({availableModels.length} models)</span>
                    <button 
                        type="button" 
                        class="btn-icon-subtle" 
                        title="بروزرسانی زنده لیست مدل‌ها از هرمس" 
                        on:click={handleRefreshModels}
                        style="background: none; border: none; cursor: pointer; font-size: 12px; opacity: 0.85; padding: 0 2px;"
                    >🔄</button>
                </div>
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

        <!-- Step 4: Reasoning Effort (گزینه ۴۱ در CLI hermes model) -->
        <div class="form-group" style="margin-top: 14px; border-top: 1px solid var(--hermes-border); padding-top: 12px;">
            <div class="label-row">
                <label for="select-reasoning">🧠 سطح تفکر و استدلال مدل (Reasoning Effort)</label>
                <span class="key-status-tag" style="color: var(--hermes-gold);">گزینه ۴۱ CLI</span>
            </div>
            <select 
                id="select-reasoning" 
                class="form-select" 
                value={$selectedReasoningEffort} 
                on:change={handleReasoningEffortChange}
                disabled={!isReasoningSupported}
            >
                {#if !isReasoningSupported}
                    <option value="none">غیرفعال (این مدل از تفکر و استدلال پشتیبانی نمی‌کند)</option>
                {:else}
                    {#each rawEfforts.filter(e => !isReasoningMandatory || e !== 'none') as eff}
                        <option value={eff}>{effortLabels[eff] || eff}</option>
                    {/each}
                    {#if !isReasoningMandatory}
                        <option value="none">Disable reasoning (غیرفعال‌سازی تفکر / بدون تگ think)</option>
                        <option value="default">Default / Skip (تنظیم پیش‌فرض سیستم)</option>
                    {/if}
                {/if}
            </select>
            <span class="form-help">این گزینه مستقیماً به پروتکل ACP و تنظیمات config.yaml متصل است و عمق تفکر مدل‌های استدلالی (مانند Nemotron Ultra، DeepSeek R1، و Claude Thinking) را در پاسخ‌دهی کنترل می‌کند.</span>
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
