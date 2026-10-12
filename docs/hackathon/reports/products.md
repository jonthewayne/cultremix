# Products and placement report (October 10)

A creator picks which products a design comes on when they publish it, and places it once. An admin approves each design for sale, which makes a print file for every product it comes on and then a Shopify product for each. Buyers pick the garment, then the color and size, and each order line goes to Printful with that garment's own print file on the right side.

## How placement works

A placement is stored as three relative settings, so one choice fits every product (`src/lib/print/shirtPlacement.ts`):

| Setting | Meaning |
| --- | --- |
| `side` | front or back |
| `size` | a share of Full, the largest the design fits on that side with 0.5 in clear all round (0.2 to 1) |
| `drop` | a share of the room left above and below it: 0 at the top of the print area, 1 at the bottom |

It's always centered left to right. Each product turns it into inches for its own print area (`toInches`). The presets are shares too: Small 0.4, Medium 0.65, Large 0.85, Full 1. The default is Large near the top (0.85, 0.08): 9.35 in wide on a tee's 12 x 16 in front, 11.05 in on a hoodie's 14 x 14 in front. Size is measured against Full rather than the area's width, because a share of the width can push a tall design off a square hoodie front; a share of Full always fits.

The work stores `printPlacement` (shared) and `printProducts` (the Printful product ids it comes on, each with its own placement when the creator chose "Place it separately"). Works published before this sell on the default product with the default placement.

The Print Studio (`/print/<cr>`) places the front of the work's first product in inches, and the two placements always describe the same print, so the newest choice is what prints and what the work page says (October 12; before, the Print Studio's placement won at print time while the work page kept describing the publish placement):

- Until a placement is saved in the Print Studio, it starts from the publish placement (`print.studio` returns it as `publishPlacement` when it's on the front). It used to start from its own default, up to 12 inches at the top, and the first adjustment saved that instead of the creator's choice.
- Saving there writes the work's placement for that product (`withProductPlacement` in `convex/lib/shopProduct.ts`): the shared placement when it's the work's only product, else that product's own ("placed separately"). Relative placements are centered, so a sideways nudge stays in the Print Studio.
- Changing the placement on the work page moves the Print Studio's to match, keeping its art version and color (`followPublishPlacement` in `convex/lib/printSync.ts`), even after the Print Studio's own print file is made: approval makes each product's print file from this placement, and the Print Studio's file (`works.printKey`, which never changes) is only the fallback for orders from before listings. Not while the Print Studio renders, or when the product is printed on its back.

## Products

`merchProducts` gained `offered` (several products can be on offer; the active one is the default, whose colors are the palette), `kind` (tee, long sleeve, sweatshirt, hoodie, tank), `shopName`, prices for S–XL and 2XL, `backExtraCents`, front and back print areas, and `placements` (the DTG placements Printful's public catalog lists, with what each adds). A product without a "back" placement sells front prints only.

Defaults come from the kind (`GARMENT_KINDS` in `shared/config/print-products.ts`): 12 x 16 in fronts and backs, 14 x 14 in hoodie fronts, and starting prices ($36 tee, $56 hoodie, $50 sweatshirt, $42 long sleeve, $34 tank). A back print adds Printful's catalog extra rounded up to a dollar ($5.95 becomes $6). Admin, Products edits all of it per product.

Print areas, checked October 10: Printful's regular DTG front is 12 x 16 in; its 15 x 18 in front (`front_large`) exists on a few shirts and sizes and costs $5.95 more, so the shop doesn't use it. Backs are 12 x 16 in. Hoodie fronts reach 14 x 14 in on the largest sizes. Printful's print-file endpoint needs a store token, so these stay unverified per product until one exists.

## Print files

Each product gets its own file: the design placed where its creator chose, on that product's whole print area at 300 DPI (3600 x 4800 px for 12 x 16 in, 4200 x 4200 px for 14 x 14 in), transparent sRGB PNG. That's the size Printful expects for the placement, so the order sends no position, and when Printful shrinks a print for smaller sizes the file shrinks as one piece and the design stays centered.

The art is the version placed in the Print Studio when there is one, else version 1 (the published art). Art up to 1536 px on its long side is upscaled first with Topaz at no credit cost; larger art is used as it is.

## Approval (Admin, For sale)

`sales.approve` fixes a listing for each picked product that's still on offer (product, kind, placement, the print area on that side, prices with any back extra, colors with Printful variant ids). A product that carries none of the design's colors is skipped and named. Then `advancePrep` walks the steps, each nudged by the Print Studio as versions finish (`convex/lib/salePrep.ts`):

1. Version 1 is created and measured.
2. The art is upscaled (needs the Print-size art switch on and room in the fal budget; two failures stop it).
3. `printTools.renderListings` makes every product's file in one run and runs the print check on each.
4. Each listing goes to Shopify (`shopify.syncListing`).

A listing whose file fails waits, with the reason shown, until it's approved again. Approving again keeps a file whose placement and print area didn't change. Pause and resume work per product.

## Shopify and the buy box

One Shopify product per design and product: handle `cr-FFF-EEE-<printful id>`, title `CR FFF-EEE · Title · Garment`, SKU `CR-FFF-EEE-<printful id>-<COLOR>-<SIZE>`, product type from the kind, and a `printful_product` metafield. The productSet query now reads back up to 250 variants (13 colors x 5 sizes is 65). `workVariants` rows carry the listing, so an order line finds its print file and side. Product sync now runs while checkout is off, so approved works reach the store before buying opens. Publishing no longer lists anything by itself.

The public `offer` returns each live product with its colors, sizes, prices, and side. The buy box shows a Style picker when there's more than one, and the cart server checks the product, color, and size against the live offer.

## Fulfillment and the model photo

Each Printful order line sends its listing's print file on `front` or `back`. Variants from before listings fall back to the work's Print Studio file on the front.

The model photo follows the first product the work comes on: the garment ("pullover hoodie, hood down"), the print size and spot ("a medium-size print centered on the upper chest"), and for a back print a pose from behind, looking back over one shoulder.

## Checked

- Unit tests: placement math on tee and hoodie areas, that no input leaves the print area, round trips, product defaults, listings, and Shopify product input. Backend tests: approval on two products, the upscale, both files, skipping, holding a failed file, keeping files on re-approval, pause and resume, the offer, the cart, Shopify sync, and a back print reaching Printful on the back.
- On dev, a real run: CR 106-001 "Slow Roll" published on the 1717 tee (front, Medium) and the Gildan 18500 hoodie (its own back, Large), approved, upscaled by Topaz from 756 x 770 px to 3024 x 3080 px, and rendered to two 3600 x 4800 px files at 423 and 323 DPI. Both wait for Shopify, which isn't set up on dev.

## Open

- Confirm each product's print areas and placement names with Printful's print-file endpoint, and confirm with one draft order that a whole-area file without a position prints as placed. Both need a Printful token.
- A small second design on the front of a back print (a chest mark) is left for later.

