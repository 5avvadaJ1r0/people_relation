import { describe, expect, it } from "vitest";
import {
  displayPersonNameFromWikiTitle,
  findPostedMasterMatchingExtractMaster,
  isPrincipalRelationsCacheSource,
  mergeRelationViewsWithPostedPersons,
  normWikiTitleForMatch,
  pickServerPersonForWikiTitle,
  titleFromJaWikipediaUrl,
} from "./wikiPersonMatch";
import type { ApiPerson, ApiRelation, RelationView } from "./types";

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

  it("同じ表示名で複数ヒットするときは has_relations 真（主体者）を優先する", () => {
    const rows = [
      person({
        id: 1,
        name: "山田太郎",
        title: "山田太郎",
        url: "https://example.com/slave",
        has_relations: false,
      }),
      person({
        id: 2,
        name: "山田太郎",
        title: "山田太郎 (政治家)",
        url: "https://ja.wikipedia.org/wiki/%E5%B1%B1%E7%94%B0%E5%A4%AA%E9%83%8E_(%E6%94%BF%E6%B2%BB%E5%AE%B6)",
        has_relations: true,
      }),
    ];
    expect(pickServerPersonForWikiTitle("山田太郎 (政治家)", rows)?.id).toBe(2);
  });

  it("同一タイトルに複数行がマッチするとき先頭が slave でも主体者を返す", () => {
    const rows = [
      person({
        id: 10,
        name: "佐藤花子",
        title: "佐藤花子",
        url: "https://example.com/a",
        has_relations: false,
      }),
      person({
        id: 11,
        name: "佐藤花子",
        title: "佐藤花子",
        url: "https://example.com/b",
        has_relations: true,
      }),
    ];
    expect(pickServerPersonForWikiTitle("佐藤花子", rows)?.id).toBe(11);
  });
});

describe("mergeRelationViewsWithPostedPersons", () => {
  it("POST 応答から関連者行へ slavePerson をマージする", () => {
    const relViews: RelationView[] = [
      {
        slave: { name: "乙", title: "乙T", url: "https://example.com/b" },
        forwardPoint: 1,
        reversePoint: 0,
        totalPoint: 1,
        hasWikiPage: true,
      },
    ];
    const posted: ApiRelation[] = [
      {
        master: {
          id: 1,
          name: "甲",
          title: "甲T",
          url: "https://example.com/a",
          has_relations: true,
          executed_as_master_at: null,
        },
        slave: {
          id: 2,
          name: "乙",
          title: "乙T",
          url: "https://example.com/b",
          has_relations: true,
          executed_as_master_at: null,
        },
        point: 1,
      },
    ];
    const merged = mergeRelationViewsWithPostedPersons(relViews, posted);
    expect(merged[0]?.slavePerson?.id).toBe(2);
    expect(merged[0]?.slavePerson?.has_relations).toBe(true);
  });
});

describe("findPostedMasterMatchingExtractMaster", () => {
  const masterOut = (
    id: number,
    name: string,
    title: string,
    url: string,
    has_relations: boolean,
  ): ApiRelation["master"] => ({
    id,
    name,
    title,
    url,
    has_relations,
    executed_as_master_at: null,
  });

  it("master.url が一致すればその master を返す", () => {
    const posted: ApiRelation[] = [
      {
        master: masterOut(1, "甲", "甲T", "https://ja.wikipedia.org/wiki/%E7%94%B2", true),
        slave: masterOut(2, "乙", "乙T", "https://example.com/b", false),
        point: 1,
      },
    ];
    const extractMaster = { name: "甲", title: "甲T", url: "https://ja.wikipedia.org/wiki/%E7%94%B2" };
    expect(findPostedMasterMatchingExtractMaster(posted, extractMaster)?.id).toBe(1);
  });

  it("URL 文字列がずれても記事タイトル（URL 由来）が一致すれば master を返す", () => {
    const posted: ApiRelation[] = [
      {
        master: masterOut(
          9,
          "甲",
          "甲 正規",
          "https://ja.wikipedia.org/wiki/%E7%94%B2_%E6%AD%A3%E8%A6%8F",
          true,
        ),
        slave: masterOut(2, "乙", "乙T", "https://example.com/b", false),
        point: 1,
      },
    ];
    const extractMaster = {
      name: "甲",
      title: "甲T",
      url: "https://ja.wikipedia.org/wiki/%E7%94%B2%20%E6%AD%A3%E8%A6%8F",
    };
    expect(findPostedMasterMatchingExtractMaster(posted, extractMaster)?.id).toBe(9);
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
