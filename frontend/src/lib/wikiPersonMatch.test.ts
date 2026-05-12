import { describe, expect, it } from "vitest";
import {
  displayPersonNameFromWikiTitle,
  isPrincipalRelationsCacheSource,
  normWikiTitleForMatch,
  pickServerPersonForWikiTitle,
  titleFromJaWikipediaUrl,
} from "./wikiPersonMatch";
import type { ApiPerson } from "./types";

const person = (over: Partial<ApiPerson> & Pick<ApiPerson, "id" | "name" | "title" | "url">): ApiPerson => ({
  has_relations: false,
  ...over,
});

describe("displayPersonNameFromWikiTitle", () => {
  it("曖昧さ回避の括弧以降を落とす", () => {
    expect(displayPersonNameFromWikiTitle("山田太郎 (俳優)")).toBe("山田太郎");
  });
});

describe("normWikiTitleForMatch", () => {
  it("アンダースコアと連続空白を正規化する", () => {
    expect(normWikiTitleForMatch("  A_B  C  ")).toBe("A B C");
  });
});

describe("titleFromJaWikipediaUrl", () => {
  it("パーセントエンコードされた ja.wikipedia の /wiki/ からタイトルを復元する", () => {
    const u = "https://ja.wikipedia.org/wiki/%E5%A0%80%E6%B1%9F%E8%B2%B4%E6%96%87";
    expect(titleFromJaWikipediaUrl(u)).toBe("堀江貴文");
  });

  it("対象外ホストでは null", () => {
    expect(titleFromJaWikipediaUrl("https://en.wikipedia.org/wiki/Foo")).toBeNull();
  });
});

describe("pickServerPersonForWikiTitle", () => {
  it("name / title が Wikipedia 記事タイトルと一致すれば拾う", () => {
    const rows = [
      person({ id: 1, name: "別名", title: "堀江貴文", url: "https://example.com/x", has_relations: false }),
    ];
    expect(pickServerPersonForWikiTitle("堀江貴文", rows)?.id).toBe(1);
  });

  it("記事 URL 由来の正規タイトルが一致すれば拾う", () => {
    const rows = [
      person({
        id: 55,
        name: "堀江貴文",
        title: "堀江貴文",
        url: "https://ja.wikipedia.org/wiki/%E5%A0%80%E6%B1%9F%E8%B2%B4%E6%96%87",
        has_relations: false,
      }),
    ];
    expect(pickServerPersonForWikiTitle("堀江貴文", rows)?.id).toBe(55);
  });
});

describe("isPrincipalRelationsCacheSource", () => {
  it("has_relations が真のときのみキャッシュ対象", () => {
    expect(isPrincipalRelationsCacheSource(undefined)).toBe(false);
    expect(
      isPrincipalRelationsCacheSource(
        person({
          id: 55,
          name: "堀江貴文",
          title: "堀江貴文",
          url: "https://ja.wikipedia.org/wiki/%E5%A0%80%E6%B1%9F%E8%B2%B4%E6%96%87",
          has_relations: false,
        })
      )
    ).toBe(false);
    expect(
      isPrincipalRelationsCacheSource(
        person({
          id: 52,
          name: "西村博之",
          title: "西村博之",
          url: "https://ja.wikipedia.org/wiki/%E8%A5%BF%E6%9D%91%E5%8D%9A%E4%B9%8B",
          has_relations: true,
          executed_as_master_at: "2026-05-12T03:58:15.582Z",
        })
      )
    ).toBe(true);
  });
});
