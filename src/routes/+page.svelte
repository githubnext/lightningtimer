<script>
  import { onMount } from 'svelte';
  import { HourglassHigh, HourglassMedium, HourglassLow } from 'phosphor-svelte';

  const DEFAULT_DURATION = 5 * 60;
  const STORAGE_KEY = 'lightningtimer-duration';

  let durationSeconds = DEFAULT_DURATION;
  let remainingMs = DEFAULT_DURATION * 1000;
  let displaySeconds = DEFAULT_DURATION;
  let status = 'idle';
  let endTime = 0;
  let frameId = 0;
  let settingsMinutes = 5;
  let settingsSeconds = 0;
  let settingsError = '';
  let isFullscreen = false;
  /** @type {HTMLDialogElement} */
  let settingsDialog;

  $: visualState = displaySeconds === 0
    ? 'finished'
    : displaySeconds <= 15
      ? 'critical'
      : displaySeconds <= 60
        ? 'warning'
        : 'normal';
  $: formattedTime = formatTime(displaySeconds);
  $: minuteText = String(Math.floor(displaySeconds / 60)).padStart(2, '0');
  $: secondText = String(displaySeconds % 60).padStart(2, '0');
  $: progress = durationSeconds > 0
    ? Math.max(0, Math.min(1, 1 - remainingMs / (durationSeconds * 1000)))
    : 0;
  $: hourglassState = progress < 1 / 3 ? 'high' : progress < 2 / 3 ? 'medium' : 'low';
  $: statusText = status === 'running'
    ? 'In progress'
    : status === 'paused'
      ? 'Paused'
      : status === 'finished'
        ? "Time's up"
        : 'Ready';

  onMount(() => {
    const savedDuration = Number.parseInt(localStorage.getItem(STORAGE_KEY) || '', 10);
    if (Number.isFinite(savedDuration) && savedDuration > 0) {
      durationSeconds = savedDuration;
      remainingMs = savedDuration * 1000;
      displaySeconds = savedDuration;
    }

    const updateFullscreen = () => {
      isFullscreen = Boolean(document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', updateFullscreen);

    return () => {
      cancelAnimationFrame(frameId);
      document.removeEventListener('fullscreenchange', updateFullscreen);
    };
  });

  /** @param {number} totalSeconds */
  function formatTime(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  /** @param {number} totalSeconds */
  function spokenTime(totalSeconds) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const parts = [];
    if (minutes) parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
    if (seconds || !minutes) parts.push(`${seconds} second${seconds === 1 ? '' : 's'}`);
    return parts.join(' and ');
  }

  /** @param {number} now */
  function tick(now) {
    remainingMs = Math.max(0, endTime - now);
    displaySeconds = Math.ceil(remainingMs / 1000);

    if (remainingMs <= 0) {
      remainingMs = 0;
      displaySeconds = 0;
      status = 'finished';
      frameId = 0;
      return;
    }

    frameId = requestAnimationFrame(tick);
  }

  function startTimer() {
    if (status === 'finished') {
      remainingMs = durationSeconds * 1000;
      displaySeconds = durationSeconds;
    }
    if (remainingMs <= 0) return;

    cancelAnimationFrame(frameId);
    endTime = performance.now() + remainingMs;
    status = 'running';
    frameId = requestAnimationFrame(tick);
  }

  function pauseTimer() {
    if (status !== 'running') return;
    remainingMs = Math.max(0, endTime - performance.now());
    displaySeconds = Math.ceil(remainingMs / 1000);
    status = remainingMs > 0 ? 'paused' : 'finished';
    cancelAnimationFrame(frameId);
    frameId = 0;
  }

  function toggleTimer() {
    if (status === 'running') pauseTimer();
    else startTimer();
  }

  function resetTimer(autostart = false) {
    cancelAnimationFrame(frameId);
    frameId = 0;
    remainingMs = durationSeconds * 1000;
    displaySeconds = durationSeconds;
    status = 'idle';
    if (autostart) startTimer();
  }

  function openSettings() {
    if (status === 'running') pauseTimer();
    settingsMinutes = Math.floor(durationSeconds / 60);
    settingsSeconds = durationSeconds % 60;
    settingsError = '';
    settingsDialog.showModal();
  }

  function closeSettings() {
    settingsDialog.close();
  }

  /** @param {number} minutes */
  function choosePreset(minutes) {
    settingsMinutes = minutes;
    settingsSeconds = 0;
    settingsError = '';
  }

  /** @param {SubmitEvent} event */
  function applySettings(event) {
    event.preventDefault();
    const minutes = Number(settingsMinutes);
    const seconds = Number(settingsSeconds);
    const nextDuration = Math.floor(minutes * 60 + seconds);

    if (!Number.isFinite(nextDuration) || nextDuration < 1) {
      settingsError = 'Set a duration of at least one second.';
      return;
    }

    durationSeconds = nextDuration;
    localStorage.setItem(STORAGE_KEY, String(nextDuration));
    resetTimer();
    settingsDialog.close();
  }

  /** @param {MouseEvent} event */
  function handleBackdropClick(event) {
    if (event.target === settingsDialog) closeSettings();
  }

  /** @param {KeyboardEvent} event */
  function handleKeydown(event) {
    if (settingsDialog?.open || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    const isEditing = target instanceof HTMLInputElement
      || target instanceof HTMLTextAreaElement
      || target instanceof HTMLSelectElement
      || (target instanceof HTMLElement && target.isContentEditable);
    if (isEditing) return;

    if (event.code === 'Space') {
      event.preventDefault();
      toggleTimer();
    } else if (event.key.toLowerCase() === 'r') {
      event.preventDefault();
      resetTimer();
    } else if (event.key.toLowerCase() === 's') {
      event.preventDefault();
      openSettings();
    }
  }

  async function toggleFullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  }

  /**
   * @param {HTMLElement} node
   * @param {string} _value
   */
  function fitText(node, _value) {
    const container = node.parentElement;
    let animationFrame = 0;

    const fit = () => {
      if (!container) return;
      const { width, height } = container.getBoundingClientRect();
      let low = 20;
      let high = Math.max(20, height * 1.5);

      for (let i = 0; i < 12; i += 1) {
        const middle = (low + high) / 2;
        node.style.fontSize = `${middle}px`;
        const bounds = node.getBoundingClientRect();
        if (bounds.width <= width * 0.92 && bounds.height <= height * 0.76) low = middle;
        else high = middle;
      }
      node.style.fontSize = `${low}px`;
    };

    const scheduleFit = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(fit);
    };
    const observer = new ResizeObserver(scheduleFit);
    if (container) observer.observe(container);
    scheduleFit();

    return {
      /** @param {string} _value */
      update(_value) {
        scheduleFit();
      },
      destroy() {
        cancelAnimationFrame(animationFrame);
        observer.disconnect();
      }
    };
  }
</script>

<svelte:head>
  <title>Lightning Timer</title>
</svelte:head>

<svelte:window onkeydown={handleKeydown} />

<main class:warning={visualState === 'warning'} class:critical={visualState === 'critical'} class:finished={visualState === 'finished'}>
  <div class="ambient" aria-hidden="true"></div>
  <div class="progress" aria-hidden="true">
    <div class="progress__fill" style:width={`${progress * 100}%`}></div>
  </div>

  <section class="timer-stage" aria-label="Timer">
    <button
      class="time-button"
      type="button"
      onclick={toggleTimer}
      aria-label={`${spokenTime(displaySeconds)} remaining. ${status === 'running' ? 'Pause' : status === 'finished' ? 'Restart' : 'Start'} timer.`}
    >
      <span class="time" use:fitText={formattedTime}>
        <span class="time__digits">{minuteText}</span>
        <span class="hourglass" aria-hidden="true">
          {#if hourglassState === 'high'}
            <HourglassHigh size="0.465em" weight="duotone" />
          {:else if hourglassState === 'medium'}
            <HourglassMedium size="0.465em" weight="duotone" />
          {:else}
            <HourglassLow size="0.465em" weight="duotone" />
          {/if}
        </span>
        <span class="time__digits">{secondText}</span>
      </span>
    </button>
  </section>

  <footer>
    <div class="status" aria-live="polite">
      <span class:active={status === 'running'} class="status__dot"></span>
      {statusText}
    </div>

    <div class="controls">
      <button class="control-button control-button--secondary" type="button" onclick={() => resetTimer()} aria-label="Reset timer" title="Reset timer (R)">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7v5h5M5.6 11A7 7 0 1 1 7 17.4" /></svg>
      </button>
      <button class="control-button control-button--primary" type="button" onclick={toggleTimer}>
        {#if status === 'running'}
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 7v10M15 7v10" /></svg>
          <span>Pause</span>
        {:else if status === 'finished'}
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7v5h5M5.6 11A7 7 0 1 1 7 17.4" /></svg>
          <span>Restart</span>
        {:else}
          <svg class="play-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 7 8 5-8 5Z" /></svg>
          <span>{status === 'paused' ? 'Resume' : 'Start timer'}</span>
        {/if}
      </button>
      <button class="control-button control-button--secondary settings-button" type="button" onclick={openSettings} aria-label="Set duration" title="Set duration (S)">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v4l2.5 1.5M9 3h6M12 5a8 8 0 1 1-8 8 8 8 0 0 1 8-8Z" /></svg>
      </button>
      <button class="control-button control-button--secondary" type="button" onclick={toggleFullscreen} aria-label={isFullscreen ? 'Exit full screen' : 'Enter full screen'} title={isFullscreen ? 'Exit full screen' : 'Enter full screen'}>
        {#if isFullscreen}
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3v3a2 2 0 0 1-2 2H3m13-5v3a2 2 0 0 0 2 2h3M8 21v-3a2 2 0 0 0-2-2H3m13 5v-3a2 2 0 0 1 2-2h3" /></svg>
        {:else}
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9V5a2 2 0 0 1 2-2h4m6 0h4a2 2 0 0 1 2 2v4m0 6v4a2 2 0 0 1-2 2h-4m-6 0H5a2 2 0 0 1-2-2v-4" /></svg>
        {/if}
      </button>
    </div>

    <p class="hint"><kbd>Space</kbd> start / pause&nbsp;&nbsp; <kbd>R</kbd> reset</p>
  </footer>
</main>

<dialog bind:this={settingsDialog} onclick={handleBackdropClick} oncancel={closeSettings}>
  <form onsubmit={applySettings}>
    <div class="dialog-heading">
      <div>
        <p class="eyebrow">Timer settings</p>
        <h2>Set talk duration</h2>
      </div>
      <button class="dialog-close" type="button" onclick={closeSettings} aria-label="Close settings">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" /></svg>
      </button>
    </div>

    <div class="presets" aria-label="Duration presets">
      {#each [3, 5, 7, 10] as minutes}
        <button class:chosen={settingsMinutes === minutes && settingsSeconds === 0} type="button" onclick={() => choosePreset(minutes)}>{minutes} min</button>
      {/each}
    </div>

    <div class="duration-fields">
      <label>
        <span>Minutes</span>
        <input type="number" min="0" max="999" step="1" inputmode="numeric" bind:value={settingsMinutes} oninput={() => settingsError = ''} />
      </label>
      <span class="field-divider" aria-hidden="true">:</span>
      <label>
        <span>Seconds</span>
        <input type="number" min="0" max="59" step="1" inputmode="numeric" bind:value={settingsSeconds} oninput={() => settingsError = ''} />
      </label>
    </div>

    {#if settingsError}<p class="form-error" role="alert">{settingsError}</p>{/if}

    <div class="thresholds">
      <div><span class="swatch swatch--yellow"></span><strong>1:00</strong> turns yellow</div>
      <div><span class="swatch swatch--red"></span><strong>0:15</strong> turns red</div>
    </div>

    <button class="apply-button" type="submit">Set timer</button>
  </form>
</dialog>

<style>
  main {
    --foreground: #f7f7f4;
    --muted: #92969d;
    --line: rgba(255, 255, 255, 0.13);
    --panel: rgba(255, 255, 255, 0.075);
    position: relative;
    isolation: isolate;
    display: grid;
    grid-template-rows: 1fr auto;
    width: 100%;
    height: 100dvh;
    overflow: hidden;
    color: var(--foreground);
    background: #090a0c;
    transition: color 220ms ease, background-color 350ms ease;
  }

  main.warning {
    --foreground: #ffd43b;
  }

  main.critical {
    --foreground: #ff4447;
  }

  main.finished {
    --foreground: #090909;
    --muted: rgba(0, 0, 0, 0.63);
    --line: rgba(0, 0, 0, 0.22);
    --panel: rgba(0, 0, 0, 0.1);
    background: #ed292d;
  }

  .ambient {
    position: absolute;
    z-index: -1;
    inset: -30%;
    pointer-events: none;
    background: radial-gradient(circle at 50% 48%, rgba(255, 255, 255, 0.035), transparent 42%);
  }

  .finished .ambient {
    display: none;
  }

  .progress {
    position: absolute;
    z-index: 5;
    top: 0;
    right: 0;
    left: 0;
    height: 3px;
    background: var(--line);
  }

  .progress__fill {
    height: 100%;
    background: var(--foreground);
    opacity: 0.9;
    transition: width 100ms linear, background-color 220ms ease;
  }

  footer {
    position: relative;
    z-index: 2;
    display: flex;
    align-items: center;
    padding-right: max(28px, env(safe-area-inset-right));
    padding-left: max(28px, env(safe-area-inset-left));
  }

  .status,
  .controls,
  .control-button {
    display: flex;
    align-items: center;
  }

  .control-button,
  .dialog-close {
    color: var(--foreground);
    border: 1px solid var(--line);
    background: var(--panel);
    cursor: pointer;
  }

  .control-button svg,
  .dialog-close svg {
    width: 20px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .control-button--secondary:hover {
    background: color-mix(in srgb, var(--foreground) 13%, transparent);
  }

  .timer-stage {
    position: relative;
    z-index: 1;
    min-height: 0;
  }

  .time-button {
    position: absolute;
    inset: 0;
    display: flex;
    width: 100%;
    height: 100%;
    align-items: center;
    justify-content: center;
    padding: 0;
    color: var(--foreground);
    border: 0;
    background: transparent;
    cursor: pointer;
  }

  .time {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.035em;
    font-family: ui-monospace, "SFMono-Regular", "Roboto Mono", Consolas, monospace;
    font-size: 20px;
    font-variant-numeric: tabular-nums slashed-zero;
    font-weight: 750;
    line-height: 0.82;
    white-space: nowrap;
    transition: color 220ms ease;
  }

  .time__digits {
    letter-spacing: -0.015em;
  }

  .hourglass {
    display: inline-flex;
    width: 0.62em;
    height: 0.82em;
    align-self: center;
    align-items: center;
    justify-content: center;
    color: currentColor;
    flex: 0 0 auto;
    line-height: 0;
    transform: translateY(-0.035em);
  }

  footer {
    justify-content: space-between;
    min-height: 108px;
    padding-bottom: max(18px, env(safe-area-inset-bottom));
  }

  .status {
    width: 150px;
    gap: 9px;
    color: var(--muted);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.13em;
    text-transform: uppercase;
  }

  .status__dot {
    width: 7px;
    height: 7px;
    border: 1px solid currentColor;
    border-radius: 50%;
  }

  .status__dot.active {
    border-color: var(--foreground);
    background: var(--foreground);
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--foreground) 15%, transparent);
  }

  .controls {
    position: absolute;
    left: 50%;
    gap: 10px;
    transform: translateX(-50%);
  }

  .control-button {
    height: 50px;
    justify-content: center;
    border-radius: 999px;
    font-size: 13px;
    font-weight: 750;
  }

  .control-button--secondary {
    width: 50px;
    padding: 0;
  }

  .control-button--primary {
    min-width: 150px;
    gap: 9px;
    padding: 0 24px;
    color: #090a0c;
    border-color: var(--foreground);
    background: var(--foreground);
  }

  .control-button--primary:hover {
    filter: brightness(0.9);
  }

  .control-button--primary svg.play-icon {
    fill: currentColor;
    stroke: currentColor;
  }

  .hint {
    width: max-content;
    margin: 0;
    color: var(--muted);
    font-size: 10px;
    letter-spacing: 0.05em;
    text-align: right;
    text-transform: uppercase;
    white-space: nowrap;
  }

  kbd {
    padding: 3px 5px;
    color: var(--foreground);
    border: 1px solid var(--line);
    border-radius: 4px;
    font-family: inherit;
    font-size: 9px;
  }

  dialog {
    width: min(92vw, 480px);
    padding: 0;
    color: #f7f7f4;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 24px;
    background: #15171b;
    box-shadow: 0 30px 100px rgba(0, 0, 0, 0.65);
  }

  dialog::backdrop {
    background: rgba(0, 0, 0, 0.72);
    backdrop-filter: blur(8px);
  }

  dialog form {
    padding: 28px;
  }

  .dialog-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
  }

  .eyebrow {
    margin: 0 0 6px;
    color: #92969d;
    font-size: 10px;
    font-weight: 750;
    letter-spacing: 0.16em;
    text-transform: uppercase;
  }

  h2 {
    margin: 0;
    font-size: 26px;
    letter-spacing: -0.035em;
  }

  .dialog-close {
    display: grid;
    width: 38px;
    height: 38px;
    place-items: center;
    border-radius: 50%;
  }

  .presets {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
    margin: 27px 0 22px;
  }

  .presets button {
    padding: 10px 5px;
    color: #aaaeb5;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 9px;
    background: rgba(255, 255, 255, 0.04);
    cursor: pointer;
    font-size: 12px;
    font-weight: 700;
  }

  .presets button:hover,
  .presets button.chosen {
    color: #0a0b0d;
    border-color: #f7f7f4;
    background: #f7f7f4;
  }

  .duration-fields {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 12px;
    align-items: end;
  }

  .duration-fields label span {
    display: block;
    margin: 0 0 8px;
    color: #92969d;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .duration-fields input {
    width: 100%;
    height: 64px;
    padding: 0 12px;
    color: #f7f7f4;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 12px;
    background: #0c0d10;
    font-family: ui-monospace, "SFMono-Regular", Consolas, monospace;
    font-size: 25px;
    font-weight: 700;
    text-align: center;
  }

  .field-divider {
    padding-bottom: 17px;
    color: #70747b;
    font-size: 24px;
  }

  .form-error {
    margin: 10px 0 0;
    color: #ff686a;
    font-size: 12px;
  }

  .thresholds {
    display: flex;
    gap: 22px;
    margin: 22px 0;
    padding: 14px 16px;
    color: #8e9299;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.025);
    font-size: 11px;
  }

  .thresholds div {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .thresholds strong {
    color: #d5d6d8;
  }

  .swatch {
    width: 7px;
    height: 7px;
    border-radius: 50%;
  }

  .swatch--yellow { background: #ffd43b; }
  .swatch--red { background: #ff4447; }

  .apply-button {
    width: 100%;
    height: 52px;
    color: #090a0c;
    border: 0;
    border-radius: 12px;
    background: #f7f7f4;
    cursor: pointer;
    font-weight: 800;
  }

  .apply-button:hover { background: #deded9; }

  @media (max-width: 700px) {
    footer {
      padding-right: 18px;
      padding-left: 18px;
    }

    footer { min-height: 92px; }
    .hint, .status { display: none; }
    .controls { gap: 8px; }
    .control-button { height: 46px; }
    .control-button--secondary { width: 46px; }
    .control-button--primary { min-width: 132px; padding: 0 18px; }
  }

  @media (max-height: 520px) {
    footer { min-height: 66px; padding-bottom: 8px; }
    .hint, .status { display: none; }
    .control-button { height: 42px; }
    .control-button--secondary { width: 42px; }
  }

  @media (max-width: 430px) {
    dialog form { padding: 22px; }
    .thresholds { flex-direction: column; gap: 9px; }
  }

  @media (prefers-reduced-motion: reduce) {
    main, .time, .progress__fill { transition: none; }
  }
</style>
