<script>
  /** @type {number} */
  export let progress = 0;
  /** @type {boolean} */
  export let running = false;
  /** @type {string | number} */
  export let size = '1em';

  $: elapsed = Math.max(0, Math.min(1, progress));
  $: remaining = 1 - elapsed;
  $: topLevel = 14 + 22 * elapsed;
  $: topHalfWidth = 15 * remaining;
  $: pileScale = Math.sqrt(elapsed);
  $: pileHalfWidth = 15 * pileScale;
  $: pileTop = 68 - 24 * pileScale;
  $: topSand = `M ${32 - topHalfWidth} ${topLevel} H ${32 + topHalfWidth} L 32 38 Z`;
  $: bottomSand = `M ${32 - pileHalfWidth} 68 H ${32 + pileHalfWidth} L 32 ${pileTop} Z`;

  const particles = [
    { radius: 1.35, delay: 0 },
    { radius: 0.9, delay: 0.14 },
    { radius: 1.1, delay: 0.28 },
    { radius: 0.75, delay: 0.42 },
    { radius: 1.2, delay: 0.56 },
    { radius: 0.85, delay: 0.7 }
  ];
</script>

<svg
  class="glass"
  xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 64 80"
  width={size}
  height={size}
  fill="none"
  aria-hidden="true"
>
  <path
    class="glass-pane"
    d="M15 10h34v13L33 40l16 17v13H15V57l16-17-16-17Z"
  />

  {#if remaining > 0.002}
    <path class="sand sand--top" d={topSand} />
    <line
      class="sand-surface"
      x1={32 - topHalfWidth}
      x2={32 + topHalfWidth}
      y1={topLevel}
      y2={topLevel}
    />
  {/if}

  {#if running && elapsed < 0.998}
    <line class="sand-stream" x1="32" x2="32" y1="37" y2={Math.max(39, pileTop - 1)} />
    <g class="particles">
      {#each particles as particle}
        <circle cx="32" cy="38" r={particle.radius}>
          <animate
            attributeName="cy"
            values="38;67"
            dur="0.84s"
            begin={`-${particle.delay}s`}
            repeatCount="indefinite"
          />
          <animate
            attributeName="cx"
            values="32;30.8;33.1;32"
            dur="0.84s"
            begin={`-${particle.delay}s`}
            repeatCount="indefinite"
          />
          <animate
            attributeName="opacity"
            values="0;0.9;0.75;0"
            dur="0.84s"
            begin={`-${particle.delay}s`}
            repeatCount="indefinite"
          />
        </circle>
      {/each}
    </g>
  {/if}

  {#if elapsed > 0.002}
    <path class="sand sand--bottom" d={bottomSand} />
  {/if}

  <g class="frame">
    <path d="M14 9v14l16 17-16 17v14M50 9v14L34 40l16 17v14" />
    <path d="M10 8h44M10 72h44" />
  </g>
</svg>

<style>
  .glass {
    display: block;
    overflow: visible;
    color: inherit;
  }

  .glass-pane {
    fill: currentColor;
    opacity: 0.07;
  }

  .frame {
    fill: none;
    stroke: currentColor;
    stroke-width: 3.25;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .sand {
    fill: currentColor;
  }

  .sand--top {
    opacity: 0.3;
  }

  .sand--bottom {
    opacity: 0.52;
  }

  .sand-surface {
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    opacity: 0.52;
  }

  .sand-stream {
    stroke: currentColor;
    stroke-width: 1.15;
    stroke-linecap: round;
    stroke-dasharray: 1.5 2.2;
    opacity: 0.52;
  }

  .particles {
    fill: currentColor;
  }

  @media (prefers-reduced-motion: reduce) {
    .particles {
      display: none;
    }

    .sand-stream {
      stroke-dasharray: none;
    }
  }
</style>
