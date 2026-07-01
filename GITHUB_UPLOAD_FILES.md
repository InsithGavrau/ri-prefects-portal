# Files To Upload To GitHub

Do upload:

- `assets/`
- `css/`
- `js/`
- `public/`
- `sql/`
- `supabase/`
- `tests/`
- all root `.html` files
- `.gitignore`
- `package.json`
- `package-lock.json`
- `vite.config.js`
- `README.md`
- `DEPLOYMENT.md`

Do not upload:

- `node_modules/`
- `dist/`
- `tmp/`
- `output/`

Those folders are generated locally. Cloudflare Pages will install dependencies from `package-lock.json` and build `dist/` automatically.

If GitHub web upload says "Yowza, that's a lot of files", you are probably dragging `node_modules/`. That folder contains hundreds or thousands of dependency files and should never be uploaded manually.
