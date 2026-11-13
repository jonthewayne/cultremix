# Products: hoodies, the lineup, and showing what people get

Status: for Jon's review (November 11, 2026). Nothing here is built or changed on production yet.

Sadal, a friend trying the site, said he'd buy one of the recent designs right now if it came on a hoodie. Production sells one product, a T-shirt. This plan adds a hoodie, settles which products and colors we offer, and makes the pictures on a design's page match the garment a buyer will actually get.

## What sells today

| | Production (cultremix.com) | Dev (rehearsal) |
| --- | --- | --- |
| Products on offer | Bella+Canvas 3001 tee only | Comfort Colors 1717 tee; Gildan 18500 hoodie |
| Price | $24, $26 for 2XL; a back print adds $6 | not set (kind defaults) |
| Colors | 20 of the 3001's 84 | 1717: 13 of 50; hoodie: 2 of 26 |
| Print area | 12 × 16 in front and back | hoodie front 14 × 14 in |

Most of the hoodie work already exists. A design can come on several products, each with its own print area, price, colors, and print file; placement is stored as a share of the print area, so one placement fits a tee and a hoodie; back prints and small chest marks on the front work (chest marks are behind a switch that's off); approving a design makes a Shopify product for each garment, and the buy box offers a Style picker when there's more than one. So adding a hoodie is mostly a catalog decision plus three gaps:

1. **Designs already for sale only list the tee.** Each one has to be told it comes on the hoodie too, then approved again, which makes the hoodie's print file and Shopify product. Today that's one design at a time.
2. **Colors are per product.** A design's colors are picked from the main product's palette. A hoodie has different colors under different names, so approval needs a rule for which hoodie colors a design sells in.
3. **The pictures aren't the real garment.** Buyers see an AI model photo and a drawn, flat garment. Both are approximations (see below).

## The lineup

Recommendation: keep the 3001 tee, add one premium hoodie now, and consider a heavyweight tee later. Three products is enough choice without turning publishing into a catalog chore. Prices and colors below are Printful's public catalog, fetched November 11, 2026; every candidate stocks all its colors in S to 2XL in the US.

Pictures of every candidate, with a real CultRemix design rendered on each garment by Printful's mockup generator in black, white, and a light color, are on the comparison page at https://mighteous.tailb6e2ea.ts.net:3021/products/ (tailnet only; built November 12 into `.tmp/screens/products/`). It covers six tees (3001, Comfort Colors 1717, Bella+Canvas 4810GD and 3010, AS Colour 5001, Lane Seven LS15000) and six hoodies (M2580, LS14001, Gildan 18500, SS4500, Bella+Canvas 4719, Comfort Colors 1567).

### Hoodie candidates

| Hoodie | Printful cost (M / 2XL) | Colors | Sizes | Feel |
| --- | --- | --- | --- | --- |
| **Cotton Heritage M2580** Premium Pullover | $27.84 / $29.84 | 23 | XS–4XL | Soft, premium, retail fit. A common pick for indie brands |
| **Lane Seven LS14001** Premium Mid-Weight | $23.72 / $25.72 | 12 | S–3XL | Premium feel at near-Gildan cost; fewer colors |
| Gildan 18500 Heavy Blend | $22.63 / $24.63 | 26 | S–5XL | The classic: heavy, boxy, cheaper feel; most colors |
| Independent Trading SS4500 Midweight | $32.20 / $34.20 | 21 | S–2XL | Streetwear favorite; costs more |
| Bella+Canvas 4719 Oversized Heavyweight | $37.23 / $39.23 | 12 | S–3XL | Trendy oversized fit; expensive |

**Recommended: Cotton Heritage M2580.** It matches the 3001's quality, has the most useful color range among the premium options, and runs XS to 4XL. Order samples of the M2580 and the LS14001 with a real design to compare in hand; if the LS14001 feels as good, it saves about $4 a hoodie.

Suggested M2580 colors (12): Black, Vintage Black, White, Bone, Oatmeal Heather, Charcoal Heather, Carbon Grey, Navy Blazer, Forest Green, Maroon, Military Green, Dusty Rose. Latte, Sky Blue, and Lavender could join later.

### Hoodie price

Printful charges about $9.19 to ship one hoodie in the US ($8.79 plus its 40¢ surcharge), and the store charges a flat $5.95, so each hoodie order starts $3.24 short on shipping. Under the agreed cost-first rule ([decisions.md](../decisions.md)), that shortfall comes out before anyone's share.

| M2580 at | Buyer pays (with $5.95 shipping) | Printful with shipping | Card fee | Left to share |
| --- | --- | --- | --- | --- |
| $49 | $54.95 | $37.03 | $1.89 | $16.03 |
| **$54** ($58 for 2XL) | $59.95 | $37.03 | $2.04 | **$20.88** |
| $58 | $63.95 | $37.03 | $2.15 | $24.77 |

Recommendation: **$54, $58 for 2XL**, with the store's flat $5.95 shipping kept simple for buyers. An LS14001 at $49 leaves about $20.15, the same as the M2580 at $54.

### Heavyweight tee (later)

The Comfort Colors 1717 (garment-dyed heavyweight, $15.60 / $17.60 at Printful, 50 colors) is the obvious premium tee at about $32. Wait until the hoodie and the 3001 are selling.

## Colors across products

A design picks its colors once, and each product sells in its nearest real colors:

- Publishing keeps showing the main product's palette. When a design comes on another product, each picked color maps to that product's color with the same name, else the nearest offered color by eye (the app already has this nearest-color math, \`nearestGarmentColor\`), and two picks that land on the same hoodie color count once.
- The buy box shows each product's own swatches, so a buyer switching from the tee to the hoodie sees the hoodie's real colors.
- Admin, Products shows the mapping for each design, so an odd match can be fixed.

## Pictures that match the garment

Today a design's page shows the art, an AI model photo, and a drawn garment. The AI photo is generated from a description and a drawing, so its neckline, fit, fabric, and exact shade can differ from the real product. For a hoodie that matters more: drawstrings, pocket, and hood shape are easy to get wrong.

1. **Printful product mockups in the buy box.** Printful's mockup generator renders the actual garment in the chosen color with the design at its real size and spot. Make them when a design is approved for sale (one per product and color, kept in R2), and show the one matching the buyer's style and color. This is what the buyer is purchasing, so it's the main product picture.
2. **Model photos follow the product.** A hoodie listing gets its own model photo of someone in a hoodie. The photo call gets Printful's real garment photo in that color as its reference in place of our drawing, so the garment looks like the product.
3. **The drawn garment stays in publishing**, where its job is showing the print area's edges while placing the design.

## Steps

1. **Jon:** pick the hoodie (or say "order samples first"), its price, and its colors. Order samples of the hoodie and the 3001 in two colors with one real design.
2. **Add the hoodie on production** in Admin, Products, with its colors, price, and print areas checked against Printful's print-file endpoint.
3. **"Also on hoodies" for designs already for sale:** an admin action that adds the hoodie to every design on sale (or chosen ones), keeps each design's placement, and approves them again. Check each hoodie print file at 14 × 14 in before it lists.
4. **Color mapping** across products, as above.
5. **Printful mockups** in the buy box.
6. **Model photos per product** with Printful's garment photo as the reference.
7. Turn checkout on once the economics release is out (see [the roadmap](../roadmap.md)).

Steps 2 and 3 alone get Sadal his hoodie. Steps 4 to 6 make every product page honest about what arrives.

## Decisions for Jon

- Which hoodie: M2580 (recommended), LS14001, or samples first?
- Hoodie price: $54 / $58 (recommended)?
- Hoodie colors: the 12 above?
- Should new designs come on every product by default, with the creator unticking any they don't want? (Recommended: yes.)

