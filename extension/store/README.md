# Chrome Web Store package

Everything needed to submit Orion to the Chrome Web Store.

| File | For |
| --- | --- |
| `listing.md` | Store listing tab: name, summary, description, category, assets |
| `privacy-practices.md` | Privacy practices tab: single purpose, a justification per permission, data usage, certifications, Limited Use text |
| `promo-440x280.png` | Small promo tile (from `npm run icons`) |

## Build the upload

```sh
cd extension
ORION_SERVER_URL=https://orion.example.com npm run package
```

This typechecks, runs the tests, makes a minified production build with that server baked in as the default and as the only install-time host permission, and writes `release/orion-extension-<version>.zip`. It refuses to run without `ORION_SERVER_URL` or with a non-https URL.

Bump `version` in `static/manifest.json` (and `package.json`) before each upload; the store rejects a version it has seen.

## Before submitting

- [ ] Privacy policy URL is live and includes the Limited Use text.
- [ ] 1 to 5 screenshots at 1280x800 (see `listing.md`).
- [ ] The zip's `manifest.json` lists only your server under `host_permissions`.
- [ ] Load the zip's contents unpacked once and run through: sign in, the monitoring notice, choose a tab (Chrome asks for site access), pause, never capture a site, stop.
- [ ] Distribution: for a single customer, publish as **Private** to their Google Workspace domain, or **Unlisted**, and share the link from Orion's onboarding.
