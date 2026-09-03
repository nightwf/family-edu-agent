# 禾芽家庭私教 Expert

这是 WorkBuddy 开放平台专家包。召唤专家时会引导用户连接禾芽家庭教务 MCP，并在本机填写家庭专属 Token。

用户进入对话后，专家先调用 `get_agent_bootstrap`，再根据具体孩子读取上下文并开展学习规划、作业管理、错题巩固和成长复盘。

发布前请确认：

- MCP 公网地址可用；
- `get_agent_bootstrap`、`list_children`、`get_child_context` 可正常调用；
- 头像为 512×512 且小于 500KB；
- 包内没有真实家庭 Token；
- 专家信息和开发者邮箱正确。
