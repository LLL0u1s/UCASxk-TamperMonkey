import { describe, expect, it } from "vitest";
import { hasSeat, parseQueryPage, parseSelectedCodes, parseSubmitBatch } from "../src/parser";

function doc(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

const QUERY_HTML = `
<form id="regfrm">
  <input type="hidden" name="deptIds" value="0">
  <input type="hidden" name="deptIds" value="910">
  <table><tr><th>选课</th><th>课程编码</th><th>课程名称</th><th>限选</th><th>已选</th></tr>
  <tr><td><input name="sids" value="opaque-sid"></td><td>ABC-001</td><td>测试课程</td><td>30</td><td>29</td></tr></table>
</form>`;

describe("page parser", () => {
  it("extracts the exact row, repeated hidden fields, and capacity", () => {
    const page = parseQueryPage(doc(QUERY_HTML));
    expect(page.hiddenFields).toEqual([
      { name: "deptIds", value: "0" },
      { name: "deptIds", value: "910" },
    ]);
    expect(page.courses[0]).toMatchObject({ code: "ABC-001", name: "测试课程", sid: "opaque-sid" });
    expect(hasSeat(page.courses[0]!)).toBe(true);
  });

  it("treats a disabled checkbox as unavailable", () => {
    const page = parseQueryPage(doc(QUERY_HTML.replace('name="sids"', 'name="sids" disabled')));
    expect(hasSeat(page.courses[0]!)).toBe(false);
  });

  it("parses selected codes without requiring a sid checkbox", () => {
    const page = doc("<table><tr><th>课程编码</th></tr><tr><td>ABC-001</td></tr></table>");
    expect([...parseSelectedCodes(page)]).toEqual(["ABC-001"]);
  });
});

describe("submit parser", () => {
  it("classifies successes and conflicts per course", () => {
    const html = `<label id="loginError">你选择的课程名称为【课程甲】和【已选课程】的上课时间冲突，请重新调整你选的课程，谢谢！</label>
      <label id="loginSuccess">课程[课程乙]选课成功</label>`;
    const outcomes = parseSubmitBatch(doc(html), [
      { code: "A", name: "课程甲" },
      { code: "B", name: "课程乙" },
    ]);
    expect(outcomes.A?.result).toBe("time_conflict");
    expect(outcomes.B?.result).toBe("success");
  });

  it("preserves an unknown server message", () => {
    const outcomes = parseSubmitBatch(doc('<label id="loginError">服务端自定义错误</label>'), [
      { code: "A", name: "课程甲" },
    ]);
    expect(outcomes.A).toEqual({ result: "unknown", message: "服务端自定义错误" });
  });
});
