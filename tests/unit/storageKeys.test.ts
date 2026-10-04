import { describe, expect, it } from "vitest";
import { randomCode } from "../../convex/lib/codes";
import {
  currentKind,
  designKey,
  folderOf,
  gridKey,
  isCurrentLayout,
  isImageKey,
  isOldLayout,
  pacificDate,
  photoNumberOf,
  printKey,
  sizeKey,
  testImageKey,
  uploadKey,
  workArtKey,
  workPhotoKey,
} from "../../convex/lib/sizes";

const code = "k7qm4x9tz2bw8rn5vc3hj6pd1f".replace(/[0189]/gu, "a");
const place = {
  memberId: "k17cqvg0q4m23jgrwqt3zc92zn8fdce4",
  sessionId: "ks7fw0vp2ax9hn75jtv2aa3z458fj0mj",
  // 2026-10-03 20:30 Pacific is already Oct 4 in UTC.
  sessionStartedAt: Date.parse("2026-10-04T03:30:00Z"),
  batchNumber: 3,
};

describe("storage codes", () => {
  it("are 26 lowercase base32 characters from 128 random bits", () => {
    expect(randomCode(() => new Uint8Array(16))).toBe("a".repeat(26));
    expect(randomCode(() => new Uint8Array(16).fill(255))).toBe("7".repeat(25) + "4");
    const codes = new Set(Array.from({ length: 2000 }, () => randomCode()));
    expect(codes.size).toBe(2000);
    for (const c of codes) expect(c).toMatch(/^[a-z2-7]{26}$/u);
  });
});

describe("storage keys", () => {
  it("files a batch under its member, session, and number, dated in Pacific time", () => {
    expect(pacificDate(place.sessionStartedAt)).toBe("2026-10-03");
    expect(designKey(place, 2, code)).toBe(
      "members/" + place.memberId + "/sessions/2026-10-03-" + place.sessionId + "/batch-03/design-2-" + code + "/original.png",
    );
    expect(gridKey(place, code)).toBe(
      "members/" + place.memberId + "/sessions/2026-10-03-" + place.sessionId + "/batch-03/grid-" + code + ".png",
    );
    expect(uploadKey(place.memberId, Date.parse("2026-10-03T19:00:00Z"), code, "jpg")).toBe(
      "members/" + place.memberId + "/uploads/2026-10-03-" + code + "/original.jpg",
    );
  });

  it("gives published works readable paths and their print file a code", () => {
    expect(workArtKey(101, 1)).toBe("works/101/001/original.png");
    expect(workPhotoKey(103, 12, 2)).toBe("works/103/012/photos/2/original.png");
    expect(printKey(101, 1, code)).toBe("works/101/001/print-" + code + "/print.png");
    expect(photoNumberOf(workPhotoKey(101, 1, 7))).toBe(7);
    expect(photoNumberOf(undefined)).toBeUndefined();
  });

  it("refuses codes that aren't 26 base32 characters", () => {
    expect(() => designKey(place, 1, "short")).toThrow();
    expect(() => printKey(101, 1, code.toUpperCase())).toThrow();
    expect(() => gridKey(place, code.slice(0, 25) + "1")).toThrow();
  });

  it("keeps copies beside the original in its folder", () => {
    const key = designKey(place, 1, code);
    expect(folderOf(key)).toBe(key.replace("/original.png", ""));
    expect(sizeKey(key, "x", "thumb")).toBe(key.replace("original.png", "thumb.webp"));
    expect(sizeKey(workArtKey(101, 1), "x", "medium")).toBe("works/101/001/medium.webp");
    expect(sizeKey("gen/" + "a".repeat(64) + ".png", "abc", "thumb")).toBe("sizes/abc/thumb.webp");
  });

  it("tells the current layout from older ones", () => {
    const sha = "0123456789abcdef".repeat(4);
    expect(currentKind(designKey(place, 1, code))).toBe("design");
    expect(currentKind(gridKey(place, code))).toBe("grid");
    expect(currentKind(uploadKey(place.memberId, 0, code, "webp"))).toBe("upload");
    expect(currentKind(workArtKey(101, 2))).toBe("work");
    expect(currentKind(workPhotoKey(101, 2, 1))).toBe("photo");
    expect(currentKind(printKey(101, 2, code))).toBe("print");
    expect(currentKind(testImageKey(0, code))).toBe("test");
    for (const old of [
      "designs/" + sha + "/original.png",
      "designs/" + sha + "/photos/" + sha + "/original.png",
      "uploads/" + sha + "/original.jpg",
      "grids/" + sha + "/original.png",
      "gen/" + sha + ".png",
      "inspo/" + sha + ".jpg",
      "cvx:kg2abcdefgh",
    ]) {
      expect(isCurrentLayout(old)).toBe(false);
      expect(isOldLayout(old)).toBe(true);
    }
    expect(isCurrentLayout("members/x/uploads/2026-10-03-" + code + "/original.png")).toBe(false);
  });

  it("lets members bring in uploads, designs, and published art only", () => {
    const sha = "0123456789abcdef".repeat(4);
    expect(isImageKey(uploadKey(place.memberId, 0, code, "png"))).toBe(true);
    expect(isImageKey(designKey(place, 4, code))).toBe(true);
    expect(isImageKey(workArtKey(101, 1))).toBe(true);
    expect(isImageKey("designs/" + sha + "/original.png")).toBe(true);
    expect(isImageKey("inspo/" + sha + ".jpg")).toBe(true);
    expect(isImageKey("cvx:kg2abcdefgh")).toBe(true);
    expect(isImageKey(gridKey(place, code))).toBe(false);
    expect(isImageKey(printKey(101, 1, code))).toBe(false);
    expect(isImageKey(workPhotoKey(101, 1, 1))).toBe(false);
    expect(isImageKey("designs/" + sha + "/photos/" + sha + "/original.png")).toBe(false);
    expect(isImageKey("photo/" + sha + ".png")).toBe(false);
    expect(isImageKey("../etc/passwd")).toBe(false);
  });
});
