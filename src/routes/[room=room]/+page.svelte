<script>
  import Timer from '$lib/Timer.svelte';

  /** @type {{ data: import('./$types').PageData }} */
  let { data } = $props();
</script>

{#key data.room}
  <Timer room={data.room} />
{/key}
