export const env = {
    PORT: Number(process.env.PORT || 4100),
    DATABASE_URL: process.env.DATABASE_URL || "postgresql://family_edu:family_edu@localhost:5432/family_edu",
    JWT_SECRET: process.env.JWT_SECRET || "dev-only-change-me",
    INVITE_CODES: new Set((process.env.INVITE_CODES || "HE-2026,JOJO-2026").split(",").map((item) => item.trim()).filter(Boolean)),
    PUBLIC_PATH: process.env.PUBLIC_PATH || "",
    WEB_DIST: process.env.WEB_DIST || "public",
    MCP_TOKEN: process.env.MCP_TOKEN || "",
    MCP_FAMILY_ID: process.env.MCP_FAMILY_ID || "family_001",
};
