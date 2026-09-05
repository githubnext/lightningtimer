/** @type {import('./$types').PageLoad} */
export function load({ params }) {
  return { room: params.room };
}
