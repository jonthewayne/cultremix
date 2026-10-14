# Shopify and Printful setup

What the Builder set up on October 13, 2026 in Jon's Shopify and Printful accounts, working in the CultRemix Chrome profile on mighteous (its own data folder, `~/.config/cultremix/chrome`, with remote debugging on port 9334), and what's still Jon's to do. No secret appears here; the keys are in `~/.config/cultremix/shop.env` on mighteous (mode 600) and in production's environment.

## Shopify

The store is `ksbu5d-ax.myshopify.com`, on the Basic plan ($1 a month until January 15, 2027, then $39; card rates 2.9% + 30¢ online).

- **Store name:** "My Store" became **CultRemix** (Settings, General, Store contact details). The store email was already `hey@cultremix.com`.
- **The CultRemix app**, made in the Dev Dashboard (dev.shopify.com, under the CultRemix organization) and installed on the store:
  - App URL `https://cultremix.com`, not embedded in the Shopify admin, webhooks on API version 2026-07 (the version the code pins, `SHOPIFY_API_VERSION`).
  - Scopes: `write_products`, `read_products`, `write_publications`, `read_publications`, `read_orders`, `read_merchant_managed_fulfillment_orders`, `write_merchant_managed_fulfillment_orders`, `read_shopify_payments_disputes` (the launch checklist's list).
  - Version v1 is released and active. Shopify shows "This app hasn't been reviewed" on install; that's normal for an app made for one store.
  - Its client ID and secret are `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET`. Checked: the app gets an Admin API token and reads the shop (CultRemix, Basic).
- **Headless sales channel:** installed, with a storefront named "Cult Remix Headless". Its private Storefront token is `SHOPIFY_STOREFRONT_PRIVATE_TOKEN`. Checked: it creates a cart. The token's public counterpart isn't used.
- **Shipping:** the General profile's one zone (United States) now has a single rate, **Standard, $5.95 flat**, 5 to 8 business days, with the note "Printed to order; usually arrives in 5 to 9 business days". Shopify's starter rates are gone: Express at $15 and free shipping over $70.
- **Webhooks**, subscribed by Connect Shopify (below): orders paid, orders cancelled, refunds created, and disputes created and updated, all to `https://savory-tiger-504.convex.site/webhooks/shopify`.
- **Checkout branding** (Settings, Checkout, **Customize**, Settings tab), October 13 evening: the CultRemix logo ([checkout-logo.png](checkout-logo.png), the icon and wordmark from the packing-slip logo without the tagline) at 200 px, black accent and buttons, and Inter for headings and body, the site's typeface. Shopify noted that the store's checkout configuration is part of a paused rollout; the changes saved and show in the preview.
- **Order emails** (Settings, Notifications, **Customize email templates**): the same logo at 180 px and a black accent, so the order confirmation, shipping confirmation, and Shopify's other buyer emails look like the checkout.
- **The Shopify storefront sends visitors to cultremix.com.** The Horizon theme's `layout/theme.liquid` has one line after `<head>`, `{%- unless request.design_mode -%}<script>location.replace('https://cultremix.com');</script>{%- endunless -%}`, so the checkout's logo and cart link, "Continue shopping", and anyone who finds `ksbu5d-ax.myshopify.com` land on cultremix.com (Shopify's theme editor still works). The online store's password is off (Online Store, Preferences) so the password page can't stand in front of checkout. Checkout and the order status page don't use the theme, so they're unaffected.
- **Policies** (Settings, Policies): Shopify keeps one slot per policy. Return and refund, Privacy, Terms of service, and Shipping hold the same words as cultremix.com/policies (Privacy replaced Shopify's automated policy), so checkout's footer links match the site. Contact information and Legal notice stay empty: the first asks for a business address and phone, which can wait for the LLC. When the site's wording changes, paste it into the matching slot again.

## Printful

- **Store:** a "Manual order platform / API" store, Printful's kind for a custom site, store ID **18901622**. Printful named it "Jon's Store"; it's now **CultRemix**, website `https://cultremix.com`, selling region USA. Billing uses the card Jon added (ending 1856).
- **API token** "CultRemix production", made in Printful Developers: this store only, with two scopes, orders (view and manage) and webhooks (view and manage), expiring October 12, 2028 (the longest Printful allows), contact email `hey@cultremix.com`. It's `PRINTFUL_API_TOKEN`, with `PRINTFUL_STORE_ID=18901622`. Checked: it reads the store, its orders, its webhooks, and the shirt's print files.
- **Webhooks**, set by Connect Printful (below): Printful's 7 order and shipment events go to `https://savory-tiger-504.convex.site/webhooks/printful`, and the signing key Printful returned is kept in Convex.
- **Branding** (Settings, Branding):
  - Packing slip: the CultRemix logo in pure black and white ([printful-packing-logo.png](printful-packing-logo.png), 1500 × 1000 px for Printful's 3 × 2 in space), customer service email `hey@cultremix.com`, and the message "Thanks for wearing a remix. Every CultRemix design has a public family tree: look up yours at cultremix.com, remix it, and get paid when your version sells. Questions? hey@cultremix.com". Printful says orders sent to a backup or partner facility get a plain slip.
  - Order tracking page: the same logo, the same email, and a "Visit CultRemix" button to `https://cultremix.com`, with the language detected from the buyer's browser.

## Production (cultremix.com)

- **Environment:** production's Convex has `SHOPIFY_SHOP_DOMAIN`, `SHOPIFY_CLIENT_ID`, `SHOPIFY_CLIENT_SECRET`, `PRINTFUL_API_TOKEN`, `PRINTFUL_STORE_ID`, and `PRINTFUL_AUTO_CONFIRM=true`; the `cultremix-prod` Worker has the secret `SHOPIFY_STOREFRONT_PRIVATE_TOKEN` and the var `SHOPIFY_SHOP_DOMAIN` (`wrangler.jsonc`). All set without printing a value.
- **Connected:** Connect Printful and Connect Shopify ran as the owner (the same functions as Admin, For sale). Shopify reported the Headless channel present.
- **The shirt:** the Bella+Canvas 3001 ("Staple T-Shirt", Printful product 71) is the default product: **$24, $26 for 2XL**, a back print $6 more, a 12 × 16 in print area front and back (read from Printful). Printful charges $11.92 ($13.92 for 2XL) plus shipping.
- **Its colors:** Printful lists 84 for the 3001. Twenty are on offer since the evening of October 13 (they were six): White, Black, Natural, Soft Cream, Heather Dust, Athletic Heather, Dark Grey Heather, Navy, True Royal, Steel Blue, Baby Blue, Red, Maroon, Pink, Forest, Military Green, Sage, Mustard, Autumn, and Lilac. Each comes in S to 2XL. A creator picks up to 20 when publishing (20 colors in 5 sizes is 100 Shopify variants); new designs start on the color nearest their background plus Natural, Black, Navy, and Heather Dust. Change the list in Admin, Products.
- **Designs published before that** got five colors each from `merch:backfillOfferedColors`: the colors they had, with a color the 3001 doesn't come in swapped for its nearest, then distinct colors near the design's own background, so the art keeps its contrast (light designs got light shirts, dark designs dark ones). Shittles (CR 107-001), first published on the Comfort Colors 1717 in Ivory and White, now sells in Heather Dust, White, Baby Blue, Sage, and Pink. Approving each design again put the colors on its Shopify product.
- **On sale:** all 12 published designs are approved. Each gets its print file, then a Shopify product that stays a draft until Checkout is on. Pause any of them in Admin, For sale.

## Still Jon's

1. **Finish Shopify Payments:** Settings, Payments, **Complete setup**. It asks for identity, a bank account, and a tax ID or SSN. Until it's done, checkout can't take a card.
2. **Approve the store policies** at cultremix.com/policies (they say "Draft, under review"). Shopify already has the same words. Once they're approved, the Builder turns off the Draft label (`POLICIES_DRAFT` in `src/lib/policies.ts`) and pastes any changes into Shopify.
3. Then the order steps in the [launch checklist](../launch-checklist.md#orders-in-four-steps): Checkout on, one order in Shopify Payments' test mode, then one real order.
