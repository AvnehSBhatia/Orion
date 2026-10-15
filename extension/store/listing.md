# Chrome Web Store listing

Copy for the store's **Store listing** tab. Character limits are the store's.

## Name

Orion

## Summary (132 characters max)

Keeps your team's Orion work map current from the windows, screens, and tabs you choose to share. Pause or stop anytime.

## Category

Workflow & Planning

## Language

English

## Description

Orion turns the work you are already doing into updates on your team's shared work map, so nobody has to write a status update. A budget change in Google Ads or a deal moved in HubSpot shows up in Orion on its own.

Orion is for teams whose organization runs an Orion server. You sign in with your Orion account; captures go only to your organization's server.

**You choose what Orion sees**
- Press Start capturing and pick the app windows, screens, and Chrome tabs Orion may see. Nothing else is read.
- A red ON badge shows whenever Orion is capturing. Stop, or pause for 15 minutes, an hour, or until you resume, with one click.
- Mark any site "Never capture this site". Your organization can exclude sites for everyone, too.

**Built to leave private things out**
- Passwords, payment card numbers, security codes, one-time codes, ID and bank numbers, tokens, and API keys are never copied from pages.
- Page addresses are sent without query strings or fragments.
- "Hide something" lets you black out parts of a screenshot before it leaves your browser.
- Orion does not run in incognito windows.

**Clear about monitoring**
Before the first capture, Orion shows your organization's monitoring notice and asks you to accept it.

**What gets sent**
While capturing, every few seconds (your organization sets the interval) Orion sends a JPEG of each source you chose that has changed. For Chrome tabs it also sends the page address, title, and a cleaned copy of the page text. Your organization's Orion server describes the work with an AI model and updates the map.

## Assets

| Asset | Size | File |
| --- | --- | --- |
| Store icon | 128x128 | `../static/icons/icon-128.png` |
| Small promo tile | 440x280 | `promo-440x280.png` |
| Screenshots | 1280x800, 1 to 5 | Take from a dev build against a demo org: the popup while capturing, the chooser window, the monitoring notice, and the settings page with blocked sites. Do not use real customer data. |

Regenerate the icon and promo tile with `npm run icons` (see `../scripts/icons.mjs`).
