<script>
    import { createEventDispatcher } from 'svelte';
    import { startNewSession } from '../../state/chatStore';
    import { activeTab, postToHost, autoApproveSetting, showToast } from '../../state/uiStore';
    import { t } from '../../i18n';

    export let isOpen = false;
    const dispatch = createEventDispatcher();

    function close() {
        dispatch('close');
    }

    function selectCommand(cmd) {
        close();
        if (cmd === '/new') {
            startNewSession();
            showToast('گفتگوی جدید آغاز شد');
        } else if (cmd === '/model') {
            $activeTab = 'models';
        } else if (cmd === '/skills') {
            $activeTab = 'skills';
        } else if (cmd === '/approve') {
            const next = !$autoApproveSetting;
            $autoApproveSetting = next;
            postToHost({ type: 'updateSetting', key: 'autoApprovePermissions', value: next });
            showToast(next ? 'Auto-Approve Enabled' : 'Auto-Approve Disabled');
        } else if (cmd === '/reconnect') {
            postToHost({ type: 'reconnect' });
            showToast('در حال اتصال مجدد...');
        }
    }
</script>

{#if isOpen}
    <div id="command-mode-popup" class="command-palette-popup">
        <div class="popup-header">
            <span class="popup-title">دستورات سریع</span>
            <span class="popup-close-hint" on:click={close} on:keydown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') close(); }} role="button" tabindex="0">بستن ESC</span>
        </div>
        <div class="popup-items" id="popup-command-items">
            <div class="popup-item" on:click={() => selectCommand('/new')} on:keydown={(e) => { if (e.key === 'Enter') selectCommand('/new'); }} role="button" tabindex="0">
                <span class="cmd-name">/new</span>
                <span class="cmd-desc">شروع گفت‌وگوی تازه (New Session)</span>
                <span class="cmd-key">↵</span>
            </div>
            <div class="popup-item" on:click={() => selectCommand('/model')} on:keydown={(e) => { if (e.key === 'Enter') selectCommand('/model'); }} role="button" tabindex="0">
                <span class="cmd-name">/model</span>
                <span class="cmd-desc">تغییر مدل هوش مصنوعی (Select Model)</span>
                <span class="cmd-key">↵</span>
            </div>
            <div class="popup-item" on:click={() => selectCommand('/skills')} on:keydown={(e) => { if (e.key === 'Enter') selectCommand('/skills'); }} role="button" tabindex="0">
                <span class="cmd-name">/skills</span>
                <span class="cmd-desc">مشاهده مهارت‌های هرمس (Browse Skills)</span>
                <span class="cmd-key">↵</span>
            </div>
            <div class="popup-item" on:click={() => selectCommand('/approve')} on:keydown={(e) => { if (e.key === 'Enter') selectCommand('/approve'); }} role="button" tabindex="0">
                <span class="cmd-name">/approve</span>
                <span class="cmd-desc">تغییر وضعیت تایید خودکار (Toggle Auto-Approve)</span>
                <span class="cmd-key">↵</span>
            </div>
            <div class="popup-item" on:click={() => selectCommand('/reconnect')} on:keydown={(e) => { if (e.key === 'Enter') selectCommand('/reconnect'); }} role="button" tabindex="0">
                <span class="cmd-name">/reconnect</span>
                <span class="cmd-desc">اتصال مجدد به ایجنت (Reconnect ACP)</span>
                <span class="cmd-key">↵</span>
            </div>
        </div>
    </div>
{/if}
