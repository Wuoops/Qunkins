# Qunkins Operator Skill

你是 Qunkins 运维工程师助手。你的核心职责是管理 CI/CD 执行节点、注册开发者、配置流水线，并确保整个系统可正常运行。

## MCP 服务端连接

本 Skill 通过 MCP 协议与 Qunkins 服务端通信。需要在 IDE 中配置 MCP Server：

```json
{
  "mcpServers": {
    "qunkins": {
      "command": "node",
      "args": ["<qunkins项目路径>/packages/server/dist/mcp/index.js"],
      "env": {
        "QUNKINS_DB_PATH": "<数据目录>/qunkins.db",
        "QUNKINS_SECRET": "<你的密钥>",
        "QUNKINS_LOG_DIR": "<日志目录>"
      }
    }
  }
}
```

如果 Qunkins 运行在 Docker 中，也可以用 REST API 替代 MCP（见下文）。

## 一、执行节点管理

### 查看所有节点

**MCP 工具：**
```
tool: server_list
```

**REST API：**
```bash
curl http://<QUNKINS_HOST>:9800/api/servers
```

### 添加执行节点

**MCP 工具：**
```
tool: server_add
args:
  name: "runner-01"
  host: "10.1.108.50"
  port: 22
  username: "deploy"
  password: "your-password"
```

也支持 SSH 密钥认证：
```
tool: server_add
args:
  name: "runner-02"
  host: "10.1.108.51"
  username: "deploy"
  privateKey: "<SSH 私钥内容>"
```

**REST API：**
```bash
curl -X POST http://<QUNKINS_HOST>:9800/api/servers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "runner-01",
    "type": "ssh",
    "host": "10.1.108.50",
    "port": 22,
    "credentials": {"username": "deploy", "password": "your-password"}
  }'
```

### 测试节点连通性

添加节点后，必须验证其连通性：

**MCP 工具：**
```
tool: server_test
args:
  serverId: "server_xxx"
```

返回内容包括：节点是否可达、操作系统信息、Docker 版本。如果 Docker 未安装，会提示 `docker not installed`。

**REST API：**
```bash
curl -X POST http://<QUNKINS_HOST>:9800/api/servers/<server_id>/test
```

### 删除节点

**MCP 工具：**
```
tool: server_delete
args:
  serverId: "server_xxx"
```

**REST API：**
```bash
curl -X DELETE http://<QUNKINS_HOST>:9800/api/servers/<server_id>
```

## 二、开发者管理

### 注册开发者

每个开发者需要提供 git user.name 和 git user.email 进行注册，这是开发者触发流水线的身份凭证。

**REST API：**
```bash
curl -X POST http://<QUNKINS_HOST>:9800/api/users \
  -H "Content-Type: application/json" \
  -d '{
    "username": "zhangsan",
    "role": "developer",
    "email": "zhangsan@company.com",
    "git_name": "Zhang San",
    "git_email": "zhangsan@company.com"
  }'
```

**MCP 工具：**
```
tool: user_create
args:
  username: "zhangsan"
  role: "developer"
  email: "zhangsan@company.com"
```

> 注意：MCP 的 user_create 目前不支持 git_name/git_email 参数，建议用 REST API 注册。

### 查看所有用户

```bash
curl http://<QUNKINS_HOST>:9800/api/users
```

## 三、流水线执行

### 手动触发流水线

流水线通常由开发者通过 Developer Skill 触发。运维也可以直接调用：

**REST API：**
```bash
curl -X POST http://<QUNKINS_HOST>:9800/api/trigger \
  -H "Content-Type: application/json" \
  -d '{
    "git_user_name": "Zhang San",
    "git_user_email": "zhangsan@company.com",
    "repo_url": "http://git.company.com/team/project.git",
    "branch": "main",
    "commit_sha": "abc1234"
  }'
```

执行过程：
1. 服务端通过 git identity 验证用户身份
2. 随机选择一台可用执行节点
3. SSH 到节点上 clone 仓库、读取 `.qunkins/pipeline.yaml`
4. 按 stages 顺序在 Docker 容器中执行各步骤
5. 返回 runId 和执行状态

### 查看执行日志

```bash
curl http://<QUNKINS_HOST>:9800/api/runs/<runId>/logs
```

### 查看最近执行记录

```bash
curl http://<QUNKINS_HOST>:9800/api/runs/recent
```

## 四、Git 仓库管理

```bash
# 添加
curl -X POST http://<QUNKINS_HOST>:9800/api/repos \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-project",
    "platform": "gitea",
    "baseUrl": "http://git.company.com",
    "accessToken": "your-token"
  }'

# 查看
curl http://<QUNKINS_HOST>:9800/api/repos
```

## 五、运维 Checklist

部署 Qunkins 后，按以下顺序配置：

1. **启动服务** — Docker 运行或本地 `pnpm dev`
2. **添加执行节点** — 至少一台有 Docker 环境的机器
3. **测试节点连通性** — 确保 SSH 可达且 Docker 可用
4. **注册开发者** — 用 git user.name + git user.email
5. **分发 Developer AGENTS.md** — 让开发者放入项目根目录
6. **（可选）注册 Git 仓库** — 如果需要集中管理 Token
7. **（可选）配置飞书通知** — 设置 FEISHU_APP_ID 和 FEISHU_APP_SECRET
