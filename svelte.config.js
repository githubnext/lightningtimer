import adapter from '@sveltejs/adapter-static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
  kit: {
    // GitHub project pages are served from /lightningtimer rather than /.
    // Keep the base empty during local development.
    paths: {
      base: process.env.BASE_PATH || ''
    },
    adapter: adapter({
      pages: 'build',
      assets: 'build',
      fallback: undefined,
      precompress: false,
      strict: true
    })
  }
};

export default config;
