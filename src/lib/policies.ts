// The store's policies, shown at /policies/<slug> and linked from the site footer. DRAFT until
// Jon approves them; the pages say so while it's true. Shopify's checkout shows its own copies
// (Settings, Policies), which should say the same thing.

export const POLICIES_DRAFT = true;
export const POLICIES_UPDATED = "October 10, 2026";
export const CONTACT_EMAIL = "heyyo@cultremix.com";

export type Policy = {
  slug: "shipping" | "returns" | "privacy" | "terms";
  title: string;
  summary: string;
  sections: Array<{ heading: string; body: Array<string> }>;
};

export const POLICIES: Array<Policy> = [
  {
    slug: "shipping",
    title: "Shipping",
    summary: "Every shirt is printed when you order it, then shipped with tracking.",
    sections: [
      {
        heading: "Made to order",
        body: [
          "Nothing sits in a warehouse. Your order goes to our print partner, Printful, which prints it and ships it to you.",
          "Printing usually takes 2 to 5 business days. Shipping takes 3 to 8 business days more within the United States.",
        ],
      },
      {
        heading: "Where we ship and what it costs",
        body: [
          "For now we ship within the United States only, for a flat $5.95 per order. Checkout shows the final price before you pay.",
        ],
      },
      {
        heading: "Tracking",
        body: [
          "When your order ships you get an email with the carrier and a tracking link. If something seems stuck, write to us and we'll look into it.",
        ],
      },
      {
        heading: "Lost packages",
        body: [
          "If tracking shows your package delivered and you can't find it, check with neighbors and your local post office first, then write to us within 30 days of the delivery date. If it was lost in transit, we'll send a replacement.",
          "Please double-check your address at checkout. A package returned because of a wrong address can be sent again for the cost of shipping.",
        ],
      },
    ],
  },
  {
    slug: "returns",
    title: "Returns",
    summary: "Made-to-order shirts can't be returned for size or a change of mind, but we fix anything we got wrong.",
    sections: [
      {
        heading: "If something's wrong",
        body: [
          "If your shirt arrives misprinted, damaged, or isn't what you ordered, write to us within 30 days of delivery with your order number and a photo. We'll send a replacement or refund it, your choice.",
          "You don't need to send the shirt back unless we ask.",
        ],
      },
      {
        heading: "Size and change of mind",
        body: [
          "Each shirt is printed just for you, so we can't take returns or exchanges for the wrong size or a change of mind. If you're between sizes, size up.",
        ],
      },
      {
        heading: "Canceling",
        body: [
          "Orders can be canceled for a full refund within an hour of ordering, before they go to print. Write to us as soon as you can.",
        ],
      },
      {
        heading: "Refunds",
        body: [
          "Refunds go back to your original payment method, usually within 5 to 10 business days of our approval. When a refund is made, the earnings that sale paid its designers are reversed.",
        ],
      },
    ],
  },
  {
    slug: "privacy",
    title: "Privacy",
    summary: "What we collect, why, who helps us run CultRemix, and how long we keep it.",
    sections: [
      {
        heading: "What we collect",
        body: [
          "Your account: your email address, your username, and your phone number if you add one.",
          "What you make: your prompts, the images you upload, and the designs you create and publish.",
          "Orders: the name, shipping address, email, and phone you give at checkout, and what you bought. Payment is handled by Shopify; we never see your card number.",
          "How you use CultRemix: basic records such as sign-ins, hearts, follows, and the referral code a link brought you with.",
        ],
      },
      {
        heading: "Why",
        body: [
          "To run your account and studio, make your designs, print and ship your orders, credit and pay the designers behind each sale, keep the service safe, and answer you when you write.",
          "We don't sell your personal information or use advertising trackers.",
        ],
      },
      {
        heading: "Who helps us",
        body: [
          "Shopify runs checkout and payments. Printful prints and ships orders and receives the shipping address to do it. Image services turn your prompts and uploads into designs. Cloudflare hosts the site and stores images. Convex stores the app's data. Circle holds creators' wallets. An email service sends sign-in codes and order emails.",
          "Each uses your information only to do that work for us.",
        ],
      },
      {
        heading: "What's public",
        body: [
          "A design you share with the world, its CR number, title, and description, and your username are public. Each shared design also gets a permanent public record on the Monad blockchain: its number, the design it came from, its fingerprint, and its creator's wallet address. That record can't be deleted. It never includes your name, email, or address.",
          "A design you keep just for you stays private.",
        ],
      },
      {
        heading: "How long we keep it",
        body: [
          "We remove a shipping address 30 days after its order ships or is canceled, and the raw order data Shopify sends us after 30 days. We keep order totals and earnings records as long as the law and our accounting need them.",
          "To delete your account, or to ask what we hold about you, write to us. We'll answer within 30 days.",
        ],
      },
      {
        heading: "Cookies",
        body: [
          "We use a few cookies to keep you signed in, hold your cart for 10 days, and remember a referral link for 30 days. No advertising cookies.",
        ],
      },
    ],
  },
  {
    slug: "terms",
    title: "Terms",
    summary: "The rules for making, remixing, and buying on CultRemix.",
    sections: [
      {
        heading: "Early access",
        body: [
          "CultRemix is new and changing fast. We work hard to keep it running well, but it's provided as it is, and features may change or pause.",
        ],
      },
      {
        heading: "What you make",
        body: [
          "You keep the rights you have in what you upload and create. When you share a design with the world, you let CultRemix show it, print it on the products you chose, sell it, and let others remix it on CultRemix, always crediting you as its creator or original.",
          "A remix credits the design it came from. A variation joins its family; a fork starts a new one and still names its parent.",
          "Only upload what you have the right to use. Don't publish anything that infringes someone else's trademark or copyright, impersonates someone, or is hateful, harassing, sexual involving minors, or illegal. We can remove designs that break these rules, and close accounts that keep doing it.",
          "If you think a design infringes your rights, write to us with the design's CR number and why. We'll take it down while we look into it.",
        ],
      },
      {
        heading: "Earnings",
        body: [
          "When a design sells, a share of the sale goes to the creators behind it, following the published rules (/economics/v1.json). Earnings become payable a while after an order ships, so refunds can come off first. Payouts begin after the hackathon judging, in mid-November 2026.",
        ],
      },
      {
        heading: "Buying",
        body: [
          "Prices are in US dollars and shown before you pay. Shipping and returns follow our Shipping and Returns policies. Colors on screen can differ a little from the printed shirt.",
        ],
      },
      {
        heading: "Contact",
        body: ["CultRemix is run by Jon Shumate. Write to us any time."],
      },
    ],
  },
];

export function policyBySlug(slug: string): Policy | undefined {
  return POLICIES.find((policy) => policy.slug === slug);
}

