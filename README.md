# Cart Progress Rewards

A Shopify app that shows shoppers how close their cart is to the next reward — "You're $20.00 away from free shipping!" — and updates the bar live as they add items, without editing a single line of theme code.

It has two halves:

- **An embedded admin app** where the merchant sets reward tiers, wording and colors.
- **A theme app extension** that renders the progress bar on the storefront.

## What it does

- Up to five reward tiers, each with a cart amount and a reward name.
- Merchant-editable messages with `{amount}` and `{reward}` placeholders, for an empty cart, a cart in progress, and all rewards unlocked.
- Colors for the bar, its track and the text, with a live preview in the admin.
- Two placements: an **app block** the merchant drops into any section (such as the cart page) and an **app embed** that pins a bar to the top or bottom of every page.
- Updates instantly when the cart changes, with no page reload and no theme edits.

## How it works

```
Admin dashboard (React Router, Polaris)
  │  saves JSON via GraphQL Admin API (metafieldsSet)
  ▼
Metafield: AppInstallation / cart_rewards.config
  │  read in Liquid as app.metafields.cart_rewards.config
  ▼
Theme app extension (Liquid + JS)
  │  watches fetch/XHR for Ajax Cart API calls, re-reads /cart.js
  ▼
Progress bar on the storefront
```

Three decisions worth calling out:

**Settings live on an AppInstallation metafield.** The extension's Liquid reads them directly through the `app` object, so the storefront needs no API call and no access scopes (`scopes = ""`). Because the app installation owns the data, no other app can overwrite it.

**The storefront stays in sync by watching the cart API.** Themes change the cart through `/cart/add`, `/cart/change`, `/cart/update` and `/cart/clear`. The script wraps `window.fetch` and `XMLHttpRequest`, and when it sees one of those succeed it re-reads `/cart.js` and redraws (debounced, so a burst of changes redraws once). That works across themes without hooking into any theme's own JavaScript.

**Validation runs on the server, not just in the form.** `validateConfig()` in `app/lib/rewards.ts` is shared by the browser and the server; the action re-validates every payload, sorts tiers by amount, rounds money to cents and rejects malformed colors before writing the metafield.

## Tech stack

| Layer | Tools |
| --- | --- |
| Admin app | React Router v7 (the framework formerly known as Remix), TypeScript, Node.js |
| Admin UI | Polaris web components, App Bridge |
| Data | GraphQL Admin API, metafields on `AppInstallation` |
| Storefront | Online Store 2.0 theme app extension: Liquid, JSON schema, vanilla JS, Ajax Cart API |
| Tooling | Shopify CLI, Prisma + SQLite (session storage), ESLint, Prettier, Theme Check |

## Project structure

```
app/
  lib/rewards.ts              Config shape, defaults, shared validation
  models/rewards.server.ts    GraphQL reads/writes for the metafield
  routes/app._index.tsx       Dashboard: loader, action, form, live preview
  shopify.server.ts           OAuth, sessions, App Bridge setup
extensions/cart-progress-bar/
  blocks/cart-progress-bar.liquid    App block (section target)
  blocks/cart-progress-embed.liquid  App embed (body target)
  snippets/cart-progress.liquid      Shared markup + embedded config
  assets/cart-progress.js/.css       Live updates and styling
```

## Running it locally

**Prerequisites:** Node.js 20.19+ (or 22.12+), a [Shopify dev dashboard account](https://shopify.dev), a development store, and the [Shopify CLI](https://shopify.dev/docs/api/shopify-cli).

```bash
git clone https://github.com/jmatulis/shopify-cart-progress-rewards.git
cd shopify-cart-progress-rewards
npm install

shopify app config link   # link to your own app in the dev dashboard
npm run dev               # starts the app + a tunnel; press "p" to preview
```

Then, in the app's dashboard, set your tiers and click **Save**. To show the bar on a storefront, deploy the extension and switch it on in the theme:

```bash
shopify app deploy
```

Online Store → Themes → **Customize** on the live theme → **App embeds** → enable **Sitewide cart progress** → **Save**. For a bar on the cart page, add the **Cart progress bar** block to that template.

```bash
npm run typecheck                                   # React Router typegen + tsc
npx eslint app                                      # lint the admin app
shopify theme check --path extensions/cart-progress-bar   # lint the extension
```

## Notes and limitations

- **Webhook subscriptions are commented out** in `shopify.app.toml`. Their URIs resolve against `application_url`, which is a dev tunnel that changes on every run, so Shopify rejects them at deploy time. The handlers exist in `app/routes/webhooks.app.*.tsx`; uncomment the subscriptions once the app is hosted at a stable URL.
- **Session storage is SQLite via Prisma**, which is the template default and fine for development. A hosted deployment wants a managed database.
- **Multi-currency** is handled by converting tier amounts with `Shopify.currency.rate`; tiers are stored in the shop's own currency.
- Tier amounts are compared against the cart subtotal after discounts (`cart.total_price`), which excludes shipping and taxes.

## Development notes

Developed with an AI-assisted workflow (Claude Code + Shopify Dev MCP), with the storefront script verified in a scripted browser against a mock Ajax Cart API.

Scaffolded from Shopify's [React Router app template](https://github.com/Shopify/shopify-app-template-react-router) (MIT, see `LICENSE.md`).
