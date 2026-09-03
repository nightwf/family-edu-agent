import { describe, expect, it } from "vitest";
import { buildAgentBootstrap, buildWorkbuddyOpenPlatformConfig, buildWorkbuddyPrompt } from "./workbuddy-prompt.js";

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
    expect(bootstrap.family.identity_source).toBe("X-MCP-Token");
    expect(bootstrap.children[0]).toMatchObject({ child_id: "child-1", name: "JOJO" });
    expect(bootstrap.next_action).toContain("JOJO");
  });

  it("keeps the family token in runtime connection data only", () => {
    const token = "family-test-token";
    const config = buildWorkbuddyOpenPlatformConfig(token);
    const prompt = buildWorkbuddyPrompt(token);

    expect(config.auth_mode).toBe("token");
    expect(config.token).toBe(token);
    expect(config.install_steps.join(" ")).toContain("只需配置一次");
    expect(prompt).toContain("get_agent_bootstrap");
    expect(prompt).toContain(`X-MCP-Token: ${token}`);
  });
});
