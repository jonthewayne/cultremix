import { describe, expect, it } from "vitest";
import { absoluteUrl, profileShareCard, shareMeta, workShareCard } from "../../src/lib/share";
import { SHARE_IMAGE, SITE_URL } from "../../src/lib/site";

const item = {
  cr: "101-001",
  title: "Night Market",
  creator: { username: "alice" },
  artUrl: "https://img.example.com/works/101/001/original.png",
  artMediumUrl: "https://img.example.com/works/101/001/medium.webp",
};

function content(meta: ReturnType<typeof shareMeta>, key: string) {
  return meta.find((tag) => ("property" in tag && tag.property === key) || ("name" in tag && tag.name === key))
    ?.content;
}

describe("work link previews", () => {
  it("title the CR number and name, credit the creator, and show the medium image", () => {
    const meta = shareMeta(workShareCard(item));
    expect(meta[0]).toEqual({ title: "CR 101-001 · Night Market · CultRemix" });
    expect(content(meta, "og:title")).toBe("CR 101-001 · Night Market");
    expect(content(meta, "twitter:title")).toBe("CR 101-001 · Night Market");
    expect(content(meta, "og:description")).toMatch(/^A design by @alice\./u);
    expect(content(meta, "og:image")).toBe(item.artMediumUrl);
    expect(content(meta, "twitter:image")).toBe(item.artMediumUrl);
    expect(content(meta, "twitter:card")).toBe("summary_large_image");
    expect(content(meta, "og:url")).toBe(`${SITE_URL}/cr/101-001`);
  });

  it("name the parent of a remix and work without a title", () => {
    const card = workShareCard({ ...item, title: undefined, parentCr: "100-001" });
    expect(card.title).toBe("CR 101-001");
    expect(card.description).toMatch(/^A remix of CR 100-001 by @alice\./u);
  });

  it("only ever point crawlers at absolute images", () => {
    expect(workShareCard({ ...item, artMediumUrl: "/img/abc" }).image).toBe(`${SITE_URL}/img/abc`);
    expect(workShareCard({ ...item, artMediumUrl: undefined }).image).toBe(item.artUrl);
    expect(workShareCard({ ...item, artMediumUrl: "fake:art", artUrl: "fake:art" }).image).toBe(SHARE_IMAGE);
    expect(absoluteUrl("//cdn.example.com/a.png")).toBe("https://cdn.example.com/a.png");
    expect(absoluteUrl("data:image/png;base64,AAAA")).toBeUndefined();
  });
});

describe("profile link previews", () => {
  it("use the bio and avatar when there are some", () => {
    const meta = shareMeta(
      profileShareCard({ username: "alice", creatorNumber: 3, bio: "Loud shirts.", image: "https://example.com/a.png" }),
    );
    expect(content(meta, "og:title")).toBe("@alice · Creator № 3");
    expect(content(meta, "og:description")).toBe("Loud shirts.");
    expect(content(meta, "og:image")).toBe("https://example.com/a.png");
    expect(content(meta, "twitter:card")).toBe("summary");
    expect(content(meta, "og:type")).toBe("profile");
    expect(content(meta, "profile:username")).toBe("alice");
  });

  it("fall back to the site card", () => {
    const card = profileShareCard({ username: "bob" });
    expect(card).toMatchObject({
      title: "@bob",
      description: "See what @bob is making on CultRemix.",
      image: SHARE_IMAGE,
      card: "summary_large_image",
      url: `${SITE_URL}/u/bob`,
    });
  });
});
