# Qunkins

AI 原生 CI/CD 助手 — 通过 AGENTS.md 让 IDE 中的 AI 引导开发者准备好 Docker 运行环境和流水线配置，一键触发远程执行。

## 核心理念

```
运维部署 Qunkins → 向项目仓库提交 AGENTS.md
                           ↓
开发者打开项目 → IDE 自动加载 Skill → 引导创建 Dockerfile + pipeline.yaml
                           ↓
开发者触发流水线 → Qunkins 服务端调度执行节点 → SSH + Docker 远程执行
```

**不依赖 Jenkins。** 每个项目有了规范的 Dockerfile + `.qunkins/pipeline.yaml`，Qunkins 只需要 SSH + Docker 就能执行流水线。

## 功能特性

- **AGENTS.md Skill**: 跨 IDE 标准（Cursor/Claude Code/Copilot/Windsurf 原生支持），AI 在开发过程中自动检查 CI 就绪状态
- **pipeline.yaml**: 声明式流水线配置，存在项目仓库中，与代码一起版本管理
- **远程执行**: SSH 到执行节点，clone 仓库 → docker build → 按 stages 执行
- **轻鉴权**: 使用 git user.name + user.email 鉴权，零配置体验
- **MCP Server**: 提供 pipeline_trigger / pipeline_check / pipeline_generate 等工具
- **失败分析**: 基于规则的日志失败分析引擎
- **Docker 检查**: Dockerfile 静态检查和建议

## 快速开始

### 运维：部署 Qunkins

```bash
# 克隆项目
git clone <repository-url>
cd qunkins

# 交互式引导启动
pnpm start:guided
```

引导脚本会依次完成：
1. 录入执行节点（SSH/K8s 连接信息）
2. 录入团队开发者的 Git 身份
3. 配置模型连接信息（可选）
4. 配置飞书连接信息（可选）
5. 启动服务并初始化管理员
6. 生成 AGENTS.md 模板

### 运维：分发 AGENTS.md

将 `.local/AGENTS.md` 复制到各项目仓库的根目录并提交：

```bash
cp .local/AGENTS.md /path/to/your-project/AGENTS.md
cd /path/to/your-project
git add AGENTS.md && git commit -m "chore: add Qunkins CI skill"
```

### 开发者：日常使用

1. 打开项目，IDE 自动加载 AGENTS.md
2. 正常开发，AI 会在合适时机检查 CI 就绪状态
3. 如果缺少 Dockerfile，AI 会提示并协助创建
4. 如果缺少 `.qunkins/pipeline.yaml`，AI 会根据项目类型自动生成
5. 准备好后，对 AI 说「帮我触发流水线」即可

### pipeline.yaml 格式

```yaml
version: "1"
name: my-app
docker:
  context: "."
  dockerfile: "Dockerfile"
stages:
  - name: install
    steps:
      - run: npm ci
  - name: test
    steps:
      - run: npm test
  - name: build
    steps:
      - run: npm run build
artifacts:
  - dist/
```

## 环境变量

```bash
# 必填
QUNKINS_SECRET=xxx             # 加密密钥（32 字符以上）
QUNKINS_BOOTSTRAP_KEY=xxxx     # 首次创建管理员所需引导密钥

# 选填
QUNKINS_PORT=9800              # 服务端口（默认 9800）
QUNKINS_DB_PATH=/app/data/qunkins.db  # 数据库路径
QUNKINS_AUTH_ENABLED=true      # 设置为 false 可关闭鉴权（本地开发场景）
QUNKINS_LOG_DIR=./logs         # 流水线日志目录
```

## 开发指南

### 前置要求

- Node.js 20+
- pnpm 10+

### 本地开发

```bash
pnpm install
pnpm build
pnpm test

# 启动开发服务器
cd packages/server
pnpm dev
```

### 包结构

```
packages/
├── core/        # 核心模块：加密、数据库、流水线引擎、Docker 检查
├── server/      # 服务端：API、MCP Server
├── web/         # React Dashboard（可选）
└── skills/      # AGENTS.md 模板
    └── developer/
        └── AGENTS.md
```

### API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/api/auth/identify` | POST | 轻鉴权（git identity） |
| `/api/trigger` | POST | 触发流水线执行 |
| `/api/templates/pipeline-yaml` | POST | 生成 pipeline.yaml 模板 |
| `/api/runs/:runId/logs` | GET | 获取执行日志 |
| `/api/runs/:runId/analyze` | GET | 分析流水线失败 |
| `/api/pipelines` | GET/POST | 流水线 CRUD |
| `/api/servers` | GET/POST | 服务器管理 |
| `/api/users` | GET/POST | 用户管理 |
| `/api/bootstrap/admin` | POST | 初始化管理员 |

### MCP 工具

| 工具名 | 说明 |
|------|------|
| `pipeline_trigger` | 从 IDE 触发流水线（核心） |
| `pipeline_check` | 检查项目 CI 就绪状态 |
| `pipeline_generate` | 根据项目类型生成 pipeline.yaml |
| `pipeline_status` | 查看执行状态 |
| `pipeline_logs` | 查看执行日志 |
| `run_analyze` | 分析失败原因 |

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                        接入层                                │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  AGENTS.md  │  │ MCP Server  │  │    REST API         │  │
│  │  (IDE Skill)│  │  (Stdio)    │  │    (Express)        │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
│         │                │                     │             │
│         └────────────────┼─────────────────────┘             │
│                    ┌─────▼─────┐                             │
│                    │ 鉴权层    │  git identity / API Key     │
│                    └─────┬─────┘                             │
├──────────────────────────┼───────────────────────────────────┤
│                     核心层                                    │
│  ┌─────────┐  ┌──────────────┐  ┌────────────────┐          │
│  │ Remote  │  │  Pipeline    │  │   Docker       │          │
│  │Executor │  │  Generator   │  │   Checker      │          │
│  │ (SSH)   │  │  (YAML)      │  │   (Static)     │          │
│  └─────────┘  └──────────────┘  └────────────────┘          │
├───────────────────────────────────────────────────────────────┤
│                       数据层                                   │
│  ┌────────────┐  ┌────────────────┐                           │
│  │  SQLite    │  │   文件系统      │                           │
│  │  (加密存储) │  │   pipeline.yaml │                           │
│  │  用户/密钥  │  │   执行日志       │                           │
│  └────────────┘  └────────────────┘                           │
└───────────────────────────────────────────────────────────────┘
```

## 技术栈

- **运行时**: Node.js 20 + TypeScript
- **数据库**: SQLite (better-sqlite3)
- **SSH**: ssh2
- **API**: Express.js
- **MCP**: @modelcontextprotocol/sdk
- **构建**: pnpm + turbo
- **容器**: Docker

## License

Apache 2.0
