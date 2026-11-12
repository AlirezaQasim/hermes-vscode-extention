<script>
    import { sendUserPrompt } from '../../state/chatStore';
    import { t } from '../../i18n';

    function triggerMission(prompt) {
        sendUserPrompt(prompt);
    }
</script>

<div class="mission-hub-screen">
    <div class="mission-top-banner">
        <span class="mission-banner-sub">AUTONOMOUS BY DESIGN. LOCAL BY DEFAULT.</span>
        <div class="mission-status-grid">
            <span class="status-cell-left">CORE / 01</span>
            <span class="status-cell-right">SYSTEM READY</span>
        </div>
    </div>

    <!-- Astrolabe / Celestial Compass Dial -->
    <div class="astrolabe-dial-wrap">
        <div class="astrolabe-dial">
            <div class="dial-orbit-ring">
                <div class="dial-orbit-planet"></div>
            </div>
            <div class="dial-ticks-ring"></div>
            <div class="dial-inner-ring">
                <div class="dial-core-emblem">⚚</div>
            </div>
        </div>
        <div class="mission-core-label">HERMES MISSION CORE</div>
    </div>

    <div class="mission-headings">
        <h2 class="mission-title">{t('hero.title')}</h2>
        <p class="mission-subtitle">{t('hero.subtitle')}</p>
    </div>

    <!-- Suggested Mission Cards (Figma Image 2) -->
    <div class="mission-cards-container">
        <!-- Card 1: Project Intelligence -->
        <div 
            class="mission-card" 
            on:click={() => triggerMission('معماری این پروژه را بررسی کن و برای بهینه‌سازی، یک نقشهٔ راه بده.')}
            on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') triggerMission('معماری این پروژه را بررسی کن و برای بهینه‌سازی، یک نقشهٔ راه بده.'); }}
            role="button"
            tabindex="0"
        >
            <div class="card-top-row">
                <span class="card-tag">PROJECT INTELLIGENCE</span>
                <span class="card-icon-box">⊞</span>
            </div>
            <h3 class="card-title">{t('mission.code.title')}</h3>
            <p class="card-desc">{t('mission.code.desc')}</p>
            <span class="card-arrow-btn">←</span>
        </div>

        <!-- Card 2: Debug & Optimize -->
        <div 
            class="mission-card" 
            on:click={() => triggerMission('ریشه خطاهای احتمالی، باگ‌ها و مشکلات عملکردی در این پروژه را پیدا و تحلیل کن.')}
            on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') triggerMission('ریشه خطاهای احتمالی، باگ‌ها و مشکلات عملکردی در این پروژه را پیدا و تحلیل کن.'); }}
            role="button"
            tabindex="0"
        >
            <div class="card-top-row">
                <span class="card-tag">DEBUG & OPTIMIZE</span>
                <span class="card-icon-box">⚡</span>
            </div>
            <h3 class="card-title">{t('mission.refactor.title')}</h3>
            <p class="card-desc">{t('mission.refactor.desc')}</p>
            <span class="card-arrow-btn">←</span>
        </div>
    </div>

    <!-- Workspace Sub-bar -->
    <div class="mission-workspace-subbar">
        <span class="subbar-pill workspace-pill">📁 hermes-workspace</span>
        <span class="subbar-divider">|</span>
        <span class="subbar-pill local-pill">🛡️ فقط روی دستگاه شما</span>
    </div>
</div>
