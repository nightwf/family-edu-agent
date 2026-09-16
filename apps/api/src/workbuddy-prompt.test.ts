import { describe, expect, it } from "vitest";
import { buildAgentBootstrap, buildDoubaoPrompt, buildWorkbuddyOpenPlatformConfig, buildWorkbuddyPrompt, WORKBUDDY_MCP_URL } from "./workbuddy-prompt.js";

describe("WorkBuddy integration", () => {
  it("builds a family-scoped agent bootstrap", () => {
    const bootstrap = buildAgentBootstrap({
      family_name: "测试家庭",
      children: [{ child_id: "child-1", name: "JOJO", age: 8, grade: "三年级" }],
      stats: {
        record_count: 3,
        report_count: 1,
        textbook_count: 2,
        homework_count: 4,
        knowledge_count: 5,
        wrong_question_count: 6,
      },
    });

    expect(bootstrap.agent_role).toBe("禾芽家庭私教");
    expect(bootstrap.family.identity_source).toBe("OAuth");
    expect(bootstrap.children[0]).toMatchObject({ child_id: "child-1", name: "JOJO" });
    expect(bootstrap.next_action).toContain("JOJO");
  });

  it("uses OAuth for WorkBuddy and keeps the legacy token only for Doubao backup", () => {
    const token = "family-test-token";
    const config = buildWorkbuddyOpenPlatformConfig(token);
    const prompt = buildWorkbuddyPrompt();
    const doubaoPrompt = buildDoubaoPrompt(token);

    expect(config.auth_mode).toBe("oauth");
    expect(config.token).toBeNull();
    expect(config.mcp_url).toBe(WORKBUDDY_MCP_URL);
    expect(config.install_steps.join(" ")).toContain("微信扫码");
    expect(prompt).toContain("get_agent_bootstrap");
    expect(prompt).toContain("save_knowledge_relations_batch");
    expect(prompt).not.toContain("X-MCP-Token");
    expect(doubaoPrompt).toContain(`X-MCP-Token: ${token}`);
  });
});
