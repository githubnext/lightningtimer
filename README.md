# Lightning Timer

A focused, full-screen countdown timer for lightning talks, built as a static SvelteKit app.

## Features

- Configurable duration with quick 3, 5, 7, and 10 minute presets
- Viewport-filling countdown display
- Yellow numerals for the final minute
- Red numerals for the final 15 seconds
- Red background with black numerals when time expires
- Start, pause, resume, reset, and full-screen controls
- Keyboard shortcuts: `Space` to start/pause, `R` to reset, and `S` to set the duration
- Saves the selected duration in local storage

## Development

```sh
npm install
npm run dev
```

## Build

```sh
npm run check
npm run build
```

The static site is generated in `build/`.

## GitHub Pages deployment

The workflow in `.github/workflows/deploy.yml` checks, builds, and deploys the app whenever `main` is pushed. It configures SvelteKit's base path as `/lightningtimer`, so assets work at:

<https://idan.github.io/lightningtimer/>

To enable the first deployment:

1. Push this repository to GitHub.
2. Open **Settings → Pages** in the repository.
3. Under **Build and deployment**, select **GitHub Actions** as the source.
4. Open the **Actions** tab to monitor the deployment.

You can also run the workflow manually from **Actions → Deploy to GitHub Pages → Run workflow**.
