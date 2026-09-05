import { json } from '@sveltejs/kit';

export function GET() {
  return json({ serverNow: Date.now() }, { headers: { 'Cache-Control': 'no-store' } });
}
