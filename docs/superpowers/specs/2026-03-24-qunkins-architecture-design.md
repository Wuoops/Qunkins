# Qunkins - AI 原生运维助手架构设计

> **项目名称**: Qunkins  
> **版本**: v0.1.0  
> **日期**: 2026-03-24  
> **协议**: Apache 2.0  
> **状态**: 设计阶段

---

## 1. 系统概述

### 1.1 定位

Qunkins 是一个 AI 原生运维助手，内网部署，服务开发者和运维工程师。通过 MCP 和双 Skill 体系，在 IDE 中引导开发者完成 Docker 环境和流水线配置，一键触发执行，结果推送到飞书。

### 1.2 核心价值

```
开发者视角                          运维视角
┌─────────────────────┐            ┌─────────────────────┐
│  IDE 中写代码        │            │  Web Dashboard      │
│       ↓             │            │       ↓             │
│  Skill 提示 Docker  │            │  管理服务器/K8s     │
│       ↓             │            │  配置连接信息       │
│  对话生成流水线     │            │  查看流水线状态     │
│       ↓             │            │  接收告警通知       │
│  触发流水线执行     │            │  失败分析报告       │
│       ↓             │            └─────────────────────┘
│  查看状态/接收通知   │
└─────────────────────┘
```

### 1.3 目标用户

- **MVP 阶段**: 个人开发者 / 2-5 人小团队
- **后续扩展**: 中型技术团队 / 企业级

---

## 2. 架构设计

### 2.1 架构方案选型

采用 **方案 C: 分层服务 + 共享核心**

```
┌─────────────────────────────────────────────────────────────┐
│                        接入层 (Entry Points)                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │ Web Dashboard│  │ MCP Server  │  │  Feishu Webhook     │  │
│  │  (React)    │  │  (SSE/HTTP) │  │  (接收/发送消息)    │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
├─────────┼────────────────┼─────────────────────┼─────────────┤
│         └────────────────┼─────────────────────┘             │
│                    ┌─────▼─────┐                             │
│                    │ API Layer │  RESTful + WebSocket        │
│                    │ (Express) │  统一鉴权、日志、错误处理   │
│                    └─────┬─────┘                             │
├──────────────────────────┼───────────────────────────────────┤
│                     核心层                                    │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              @qunkins/core (npm workspace)             │  │
│  │                                                        │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐ │  │
│  │  │ Pipeline │  │  Docker  │  │  Auth &  │  │Notifier│ │  │
│  │  │  Engine  │  │ Checker  │  │Encryption│  │ Module │ │  │
│  │  └──────────┘  └──────────┘  └──────────┘  └────────┘ │  │
│  │                                                        │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐ │  │
│  │  │ Monitor  │  │  Skill   │  │   Config Manager     │ │  │
│  │  │ Adapter  │  │ Registry │  │  (连接信息/密钥管理) │ │  │
│  │  └──────────┘  └──────────┘  └──────────────────────┘ │  │
│  └────────────────────────────────────────────────────────┘  │
├───────────────────────────────────────────────────────────────┤
│                       数据层                                   │
│  ┌────────────┐  ┌────────────────┐  ┌─────────────────────┐ │
│  │  SQLite3   │  │   Prometheus   │  │   文件系统           │ │
│  │  (加密存储) │  │   (可选接入)   │  │   pipeline.md       │ │
│  │  用户/密钥  │  │   监控数据     │  │   docker configs    │ │
│  │  流水线记录 │  │                │  │                     │ │
│  └────────────┘  └────────────────┘  └─────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

### 2.2 技术栈

| 层 | 技术选型 | 用途 |
|---|---------|------|
| Monorepo | pnpm workspace + Turborepo | 包管理 + 构建编排 |
| 核心 | TypeScript + Node.js | 业务逻辑 |
| API | Express.js + Zod | RESTful API + 参数校验 |
| MCP | @modelcontextprotocol/sdk | MCP Server |
| Web | React + Vite + TailwindCSS | Dashboard |
| 数据库 | better-sqlite3 | 核心存储 |
| 加密 | crypto (Node 内置) | AES-256-GCM |
| 通知 | axios (飞书) + nodemailer (邮件) | 消息推送 |
| 流水线 | child_process + python-shell | Shell/Python 执行 |
| 容器 | Docker + Docker Compose | 部署 |

---

## 3. 核心模块设计 (@qunkins/core)

### 3.1 模块结构

```
@qunkins/core
├── pipeline/          # 流水线引擎
│   ├── executor.ts    # Shell/Python 执行器
│   ├── parser.ts      # pipeline.md 解析
│   ├── scheduler.ts   # 定时/触发调度
│   └── logger.ts      # 执行日志采集
│
├── docker/            # Docker 检查
│   ├── scanner.ts     # 扫描项目 Dockerfile/docker-compose
│   ├── validator.ts   # 验证命令有效性
│   └── suggester.ts   # 生成修复建议
│
├── auth/              # 认证授权
│   ├── account.ts     # 账号管理 (CRUD)
│   ├── apiKey.ts      # API Key 生成/验证
│   ├── rbac.ts        # 角色权限 (admin/developer)
│   └── ldap.ts        # LDAP 集成 (v1.1)
│
├── crypto/            # 加密
│   ├── aes.ts         # AES-256-GCM 字段加密
│   ├── keychain.ts    # 密钥管理
│   └── vault.ts       # 敏感数据存储封装
│
├── notifier/          # 通知
│   ├── feishu.ts      # 飞书消息/卡片
│   ├── email.ts       # 邮件 (Nodemailer)
│   ├── analyzer.ts    # 失败分析报告生成
│   └── template.ts    # 消息模板引擎
│
├── monitor/           # 监控
│   ├── collector.ts   # 轻量监控采集 (30分钟，SSH/K8s)
│   ├── prometheus.ts  # Prometheus 查询封装 (可选扩展)
│   ├── grafana.ts     # Grafana 数据源兼容 (可选扩展)
│   └── metrics.ts     # 指标查询接口
│
├── skill/             # Skill 生成
│   ├── generator.ts   # 动态生成 Skill 配置
│   ├── developer.ts   # 开发者 Skill 逻辑
│   └── operator.ts    # 运维 Skill 逻辑
│
├── store/             # 数据存储
│   ├── sqlite.ts      # SQLite 封装
│   ├── migrations/    # 数据库迁移
│   └── repositories/  # 数据访问层
│
└── config/            # 配置管理
    ├── loader.ts      # YAML/ENV 配置加载
    └── schema.ts      # 配置校验 (Zod)
```

### 3.2 模块间依赖

```
skill ──→ pipeline ──→ store
  │           │          │
  │           ▼          │
  │        docker        │
  │           │          │
  ▼           ▼          │
notifier ←─ auth ──→ crypto ──→ store
                │
                ▼
             monitor
```

**规则**:
- `crypto` 和 `store` 是底层，不依赖其他模块
- `skill` 是入口，协调其他模块
- `notifier` 只被调用，不主动调用其他模块

---

## 4. MCP Server 设计

### 4.1 Tools (可执行操作)

| Tool 名称 | 权限 | 功能 |
|-----------|------|------|
| `pipeline_create` | developer+ | 通过对话创建流水线配置 |
| `pipeline_run` | developer+ | 触发流水线执行 |
| `pipeline_status` | developer+ | 查询流水线运行状态 |
| `pipeline_logs` | developer+ | 获取流水线执行日志 |
| `repo_add` | admin only | 添加 Git 仓库认证 |
| `repo_list` | admin only | 列出已配置的仓库 |
| `rules_sync` | admin only | 同步规范文件到规则仓库 |
| `rules_query` | developer+ | 按需查询公司规范详情 |
| `user_create` | admin only | 创建开发者账号并生成 API Key |
| `notify_test` | admin only | 测试飞书/邮件通知 |

### 4.2 Resources (只读数据)

| Resource URI | 内容 |
|--------------|------|
| `qunkins://servers` | 已配置的服务器列表 |
| `qunkins://pipelines` | 所有流水线配置 |
| `qunkins://runs/recent` | 最近执行记录 |
| `qunkins://metrics/summary` | 监控数据摘要 |

### 4.3 调用示例

```
IDE 中开发者: 帮我触发 order-service 的构建流水线

  ↓ AI 调用 MCP Tool

{
  "tool": "pipeline_run",
  "params": {
    "pipelineName": "build-and-deploy",
    "branch": "main"
  }
}

  ↓ Qunkins 返回

{
  "runId": "run_abc123",
  "status": "running",
  "message": "流水线已触发，可通过 pipeline_status 查询状态"
}
```

---

## 5. Skill 设计

### 5.1 双 Skill 体系

| Skill | 目标用户 | 权限范围 |
|-------|---------|---------|
| 运维 Skill | 运维工程师 | 全功能 |
| 开发者 Skill | 开发者 | 受限权限 |

### 5.2 运维 Skill 指令集

| 分类 | 指令 | 功能 |
|------|------|------|
| 服务连接 | `配置 Qunkins 服务` | 连接服务 + 输入密钥 |
| | `查看服务状态` | 查询服务运行状态 |
| Git 仓库 | `添加 Git 仓库` | 交互式添加仓库认证 |
| | `列出仓库` | 查看已配置的仓库 |
| | `删除仓库` | 移除仓库配置 |
| 服务器 | `添加服务器` | 交互式添加 SSH/K8s 连接 |
| | `列出服务器` | 查看已配置的服务器 |
| | `测试连接` | 验证服务器连通性 |
| | `删除服务器` | 移除服务器配置 |
| 通知 | `配置飞书通知` | 交互式配置飞书 Webhook |
| | `配置邮箱通知` | 交互式配置 SMTP |
| | `测试通知` | 发送测试消息 |
| 流水线 | `查看所有流水线` | 列出所有流水线 |
| | `查看最近执行` | 列出最近的执行记录 |
| | `查看执行日志 [run_id]` | 获取详细日志 |
| | `触发流水线 [name]` | 手动触发执行 |
| 用户管理 | `创建开发者` | 创建账号 + 生成 API Key |
| | `列出开发者` | 查看所有开发者账号 |
| | `重置 API Key` | 重新生成 Key |
| | `禁用开发者` | 停用账号 |
| | `删除开发者` | 删除账号 |
| 监控 (内置) | `查看服务器指标` | CPU/内存/磁盘 (从 SQLite 读取，30分钟采集) |
| | `查看容器状态` | Docker 容器运行状态 |
| | `查看服务健康` | 各服务健康检查状态 |
| 监控 (扩展) | `查看历史指标 [时间范围]` | 需启用 Prometheus (--profile monitoring) |
| | `配置 Prometheus` | 添加 Prometheus 数据源 |
| | `配置 Grafana` | 连接 Grafana 实例 |

### 5.3 开发者 Skill 指令集

| 指令 | 功能 |
|------|------|
| `检查项目配置` | 检查 Dockerfile/docker-compose 有效性 |
| `创建 Dockerfile` | 引导生成 Dockerfile |
| `创建 docker-compose` | 引导生成 docker-compose.yml |
| `创建流水线` | 对话式创建流水线配置 |
| `查看我的流水线` | 列出当前项目关联的流水线 |
| `触发流水线 [name]` | 执行指定流水线 |
| `查看流水线状态` | 查询最近执行状态 |
| `查看执行日志` | 获取执行日志 |
| `查看公司规范` | 查看当前生效的开发规范 |

### 5.4 权限对比

| 能力 | 运维 Skill | 开发者 Skill |
|------|-----------|-------------|
| 查看流水线状态 | ✅ | ✅ |
| 触发流水线 | ✅ | ✅ (自己的) |
| 创建流水线 | ✅ | ✅ (受限) |
| 添加服务器 | ✅ | ❌ |
| 添加仓库 | ✅ | ❌ |
| 管理用户 | ✅ | ❌ |
| 查看监控 | ✅ | ❌ |
| 配置通知 | ✅ | ❌ |
| Docker 检查 | ✅ | ✅ (内置规则) |

### 5.5 Docker 检查: Skill 内置 vs MCP

**设计决策**: Docker 配置检查和建议在 Skill 中实现，利用开发者本地模型，只包含必要的检查规则。

**优势**:
- 减少服务器负担
- 利用客户端 AI 能力
- 规则可离线使用

---

## 6. Git 仓库 & 规范管理

### 6.1 运维初始化流程

```
运维启动 Qunkins
       │
       ▼
  Web Dashboard / 运维 Skill 引导
       │
       ├── 1. 选择 Git 平台
       │      ○ GitLab
       │      ○ GitHub
       │      ○ Gerrit
       │
       ├── 2. 填写认证信息
       │      - Instance URL
       │      - Access Token (加密存入 SQLite)
       │
       ├── 3. 指定规则仓库
       │      - 选择已有仓库 或 创建新仓库
       │      - 仓库名: e.g. company-ai-rules
       │
       ├── 4. 选择 AI 模型类型 (决定规则文件格式)
       │      ○ Claude → claude.md
       │      ○ GPT/Copilot → .cursorrules / .github/copilot-instructions.md
       │      ○ OpenCode → AGENTS.md
       │      ○ 通用 → .ai-rules/ 目录
       │
       └── 5. 初始化规则仓库
              - Qunkins 自动生成标准规范模板
              - 推送到指定仓库
```

### 6.2 规则仓库结构

```
company-ai-rules/
├── claude.md                      # Claude 专用规则
├── AGENTS.md                      # OpenCode 专用规则
├── .cursorrules                   # Cursor 专用规则
├── .github/
│   └── copilot-instructions.md    # Copilot 专用规则
│
├── standards/
│   ├── docker-best-practices.md   # Docker 编写规范
│   ├── pipeline-conventions.md    # 流水线规范
│   ├── security-guidelines.md     # 安全规范
│   └── naming-conventions.md      # 命名规范
│
└── templates/
    ├── Dockerfile.node            # Node.js 项目模板
    ├── Dockerfile.python          # Python 项目模板
    ├── docker-compose.base.yml    # 基础 compose 模板
    └── pipeline-base.sh           # 流水线基础模板
```

### 6.3 IM 对话添加仓库

#### 飞书 Bot 交互流程

```
运维在飞书群/Qunkins Bot 对话:

运维: 添加仓库 gitlab.company.com/devops/order-service
Bot:  请提供 GitLab Access Token (用于仓库访问):
运维: glpat-xxxxxxxxxxxx
Bot:  ✅ Token 验证成功
      📦 gitlab.company.com/devops/order-service
      📋 规则文件已初始化推送到 main 分支
      🔗 已关联规则仓库: company-ai-rules

运维: 为 order-service 添加 staging 分支
Bot:  ✅ staging 分支已监控
      📋 该分支将自动继承 main 分支的规则配置
```

#### 飞书 SDK 集成

**官方库**: `@larksuiteoapi/node-sdk` (飞书官方维护，周下载 1.1M+)

```typescript
import * as lark from '@larksuiteoapi/node-sdk';

// 构造 API Client
const client = new lark.Client({
  appId: process.env.FEISHU_APP_ID,
  appSecret: process.env.FEISHU_APP_SECRET,
  domain: lark.Domain.Feishu
});

// 事件处理器 (自动处理签名验证)
const eventDispatcher = new lark.EventDispatcher({
  encryptKey: process.env.FEISHU_ENCRYPT_KEY
}).register({
  'im.message.receive_v1': async (data) => {
    // SDK 内部已完成签名验证
    const chatId = data.message.chat_id;
    const message = JSON.parse(data.message.content).text;

    // 入队处理
    await feishuQueue.add('process-message', { chatId, message });
  }
});

// WebSocket 长连接模式 (推荐，无需公网回调地址)
const wsClient = new lark.WSClient({
  appId: process.env.FEISHU_APP_ID,
  appSecret: process.env.FEISHU_APP_SECRET,
  loggerLevel: lark.LoggerLevel.info
});
wsClient.start(eventDispatcher);
```

#### BullMQ 消息队列

```typescript
import { Queue, Worker, QueueEvents } from 'bullmq';
import Redis from 'ioredis';

const connection = new Redis({
  host: 'redis',
  port: 6379,
  maxRetriesPerRequest: null
});

// 会话状态存储 (Redis Hash)
async function getOrCreateSession(chatId: string, flow: string) {
  const key = `session:${chatId}`;
  let session = await connection.hgetall(key);

  if (!session.flow || session.flow !== flow) {
    session = {
      flow,
      step: 'start',
      data: '{}',
      createdAt: Date.now().toString(),
      expiresAt: (Date.now() + 300000).toString()  // 5分钟超时
    };
    await connection.hset(key, session);
    await connection.expire(key, 300);  // TTL 5分钟
  }

  return {
    ...session,
    data: JSON.parse(session.data || '{}')
  };
}

// 消息队列
const feishuQueue = new Queue('feishu-messages', { connection });

// Worker 处理
const worker = new Worker('feishu-messages', async (job) => {
  const { chatId, message } = job.data;
  const command = parseCommand(message);

  // 获取/创建会话
  const session = await getOrCreateSession(chatId, command.type || 'unknown');

  // 状态机处理
  const result = await handleMessage(session, command);

  // 发送回复
  await client.im.message.create({
    params: { receive_id_type: 'chat_id' },
    data: {
      receive_id: chatId,
      msg_type: 'text',
      content: JSON.stringify({ text: result.reply })
    }
  });
}, { connection });

// 队列事件监听 (用于监控)
const queueEvents = new QueueEvents('feishu-messages', { connection });
queueEvents.on('failed', ({ jobId, failedReason }) => {
  console.error(`Job ${jobId} failed: ${failedReason}`);
});
```

#### 支持的飞书指令

| 指令 | 格式 | 示例 |
|------|------|------|
| 添加仓库 | `添加仓库 <url>` | 添加仓库 gitlab.company.com/devops/app |
| 添加分支 | `为 <repo> 添加 <branch> 分支` | 为 order-service 添加 staging 分支 |
| 查看仓库 | `列出仓库` | 列出仓库 |
| 测试通知 | `测试通知` | 测试通知 |

#### 多步会话状态机

```
添加仓库流程:
  start → await_token → await_confirm → completed

         ┌─────────────┐
         │   start     │
         └──────┬──────┘
                │ "添加仓库 xxx"
                ▼
         ┌─────────────┐
         │ await_token  │
         └──────┬──────┘
                │ 提供 Token
                ▼
         ┌─────────────┐
         │ await_confirm│ ← 显示仓库信息，等待确认
         └──────┬──────┘
                │ "确认" / "取消"
                ▼
         ┌─────────────┐
         │  completed   │ → 清除会话，执行操作
         └─────────────┘
```

---

## 7. IDE 规则注入

### 7.1 三层规则架构

```
┌─────────────────────────────────────────────────────────┐
│  第一层: Skill 内置核心规则 (硬编码, ~300 tokens)        │
│  - Docker 检查的基本规则                                │
│  - 流水线命名规范                                       │
│  - 安全红线（密钥不能明文等）                           │
├─────────────────────────────────────────────────────────┤
│  第二层: 项目类型规则 (按需注入, ~500 tokens)            │
│  - 检测项目类型 → 只注入相关规则                        │
│  - Node.js → Node 规范                                 │
│  - Python → Python 规范                                │
│  - 不相关的一律不注入                                   │
├─────────────────────────────────────────────────────────┤
│  第三层: 公司扩展规则 (摘要 + 按需查询)                  │
│  - 注入: 规则目录清单 (~200 tokens)                     │
│  - 不注入: 详细内容                                     │
│  - AI 需要时通过 MCP Tool 查询具体规则文件              │
└─────────────────────────────────────────────────────────┘
```

### 7.2 上下文占用估算

| 层 | 内容 | Tokens |
|---|------|--------|
| 第一层 | 核心规则 | ~300 |
| 第二层 | 项目类型规则 | ~500 |
| 第三层 | 规则目录摘要 | ~200 |
| **总计** | | **~1000** |

1000 tokens ≈ 占用约 1% 的上下文窗口 (以 100k 为例)，完全可控。

### 7.3 无感同步流程

```
开发者打开项目 / 切换分支 / Skill 激活
              │
              ▼
     Qunkins Skill 检查本地规则版本
              │
              ├── 无变化 → 静默跳过
              │
              └── 有更新 → 一次轻提示，自动拉取
                   │
                   ▼
           "🔄 开发规范已更新 (2 条变更)"
           （无选择，自动生效）
```

---

## 8. 数据模型

### 8.1 SQLite 表结构

```sql
-- 用户表
CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  role          TEXT NOT NULL CHECK(role IN ('admin', 'developer')),
  email         TEXT,
  api_key_hash  TEXT,
  created_at    INTEGER DEFAULT (unixepoch()),
  updated_at    INTEGER DEFAULT (unixepoch())
);

-- Git 仓库表
CREATE TABLE git_repos (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  platform        TEXT NOT NULL CHECK(platform IN ('gitlab', 'github', 'gerrit')),
  base_url        TEXT NOT NULL,
  access_token_enc TEXT NOT NULL,
  rules_repo      INTEGER DEFAULT 0,
  created_at      INTEGER DEFAULT (unixepoch())
);

-- 仓库-分支关联表
CREATE TABLE repo_branches (
  id            TEXT PRIMARY KEY,
  repo_id       TEXT NOT NULL REFERENCES git_repos(id),
  branch        TEXT NOT NULL,
  pipeline_id   TEXT REFERENCES pipelines(id),
  rules_version TEXT,
  created_at    INTEGER DEFAULT (unixepoch()),
  UNIQUE(repo_id, branch)
);

-- 服务器/K8s 连接表
CREATE TABLE servers (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL CHECK(type IN ('ssh', 'k8s')),
  host            TEXT NOT NULL,
  port            INTEGER,
  credentials_enc TEXT NOT NULL,
  created_at      INTEGER DEFAULT (unixepoch())
);

-- 流水线配置表
CREATE TABLE pipelines (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  repo_id     TEXT REFERENCES git_repos(id),
  server_id   TEXT REFERENCES servers(id),
  config_enc  TEXT NOT NULL,
  created_by  TEXT REFERENCES users(id),
  created_at  INTEGER DEFAULT (unixepoch())
);

-- 流水线执行记录表
CREATE TABLE pipeline_runs (
  id            TEXT PRIMARY KEY,
  pipeline_id   TEXT NOT NULL REFERENCES pipelines(id),
  status        TEXT NOT NULL CHECK(status IN ('pending', 'running', 'success', 'failed')),
  triggered_by  TEXT REFERENCES users(id),
  started_at    INTEGER,
  finished_at   INTEGER,
  exit_code     INTEGER,
  log_path      TEXT,
  error_summary TEXT,
  notified      INTEGER DEFAULT 0
);

-- 通知配置表
CREATE TABLE notify_configs (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK(type IN ('feishu', 'email')),
  config_enc  TEXT NOT NULL,
  enabled     INTEGER DEFAULT 1,
  created_at  INTEGER DEFAULT (unixepoch())
);

-- 规则版本表
CREATE TABLE rule_versions (
  id            TEXT PRIMARY KEY,
  repo_id       TEXT NOT NULL REFERENCES git_repos(id),
  file_path     TEXT NOT NULL,
  content_hash  TEXT NOT NULL,
  synced_at     INTEGER DEFAULT (unixepoch())
);

-- 服务器监控指标表 (轻量监控，30分钟采集，保留24小时)
CREATE TABLE server_metrics (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id     TEXT NOT NULL REFERENCES servers(id),
  metric_name   TEXT NOT NULL,        -- cpu_usage, memory_usage, disk_usage, network_rx, network_tx
  metric_value  REAL NOT NULL,
  collected_at  INTEGER DEFAULT (unixepoch())
);

CREATE INDEX idx_metrics_server ON server_metrics(server_id);
CREATE INDEX idx_metrics_time ON server_metrics(collected_at);
```

### 8.2 ER 关系

```
users ──1:N──→ pipelines (created_by)
users ──1:N──→ pipeline_runs (triggered_by)

git_repos ──1:N──→ repo_branches
git_repos ──1:N──→ pipelines
git_repos ──1:N──→ rule_versions

servers ──1:N──→ pipelines
servers ──1:N──→ server_metrics

pipelines ──1:N──→ pipeline_runs
```

### 8.3 加密策略

| 数据类型 | 加密方式 | 存储 |
|---------|---------|------|
| Access Token | AES-256-GCM | `access_token_enc` |
| SSH 凭证 | AES-256-GCM | `credentials_enc` |
| K8s 配置 | AES-256-GCM | `credentials_enc` |
| API Key | SHA-256 哈希 | `api_key_hash` (只存哈希) |
| 加密密钥 | 从环境变量 `QUNKINS_SECRET` 读取 | 不入库 |

---

## 9. 通知机制 & 失败分析

### 9.1 通知触发流程

```
流水线执行结束
       │
       ├── status = success
       │     └── 发送成功通知 → 飞书/邮件
       │
       └── status = failed
             ├── 1. 收集执行日志
             ├── 2. 调用 AI 分析失败原因
             ├── 3. 生成失败分析报告
             └── 4. 发送失败通知 + 分析报告
```

### 9.2 通知模板

#### 成功通知 (飞书卡片)

```
┌─────────────────────────────────────┐
│  ✅ 流水线执行成功                   │
├─────────────────────────────────────┤
│  项目: order-service                 │
│  分支: main                          │
│  触发者: zhangsan                    │
│  耗时: 2m 35s                        │
│  流水线: deploy-staging              │
└─────────────────────────────────────┘
```

#### 失败通知 (飞书卡片)

```
┌─────────────────────────────────────┐
│  ❌ 流水线执行失败                   │
├─────────────────────────────────────┤
│  项目: order-service                 │
│  分支: feature/login                 │
│  触发者: lisi                        │
│  耗时: 1m 12s                        │
│  流水线: build-and-test              │
├─────────────────────────────────────┤
│  📋 失败分析                         │
│                                     │
│  1. Docker 构建失败                  │
│     - 第 12 行 COPY 命令找不到文件   │
│     - 原因: dist/ 目录未生成         │
│     - 建议: 确保 build 命令在        │
│       Dockerfile 中先执行            │
│                                     │
│  [查看详情]  [查看日志]              │
└─────────────────────────────────────┘
```

### 9.3 失败分析引擎

#### LLM 集成方式

失败分析引擎使用 Qunkins 服务端配置的 LLM 进行日志分析。支持两种模式：

**模式 A: OpenAI 兼容 API (推荐)**
```yaml
# config.yaml
analysis:
  provider: openai
  apiKey: ${OPENAI_API_KEY}        # 环境变量注入
  model: gpt-4o-mini               # 成本控制
  baseUrl: https://api.openai.com/v1  # 或企业内部代理
```

**模式 B: 本地模型 (隐私敏感场景)**
```yaml
analysis:
  provider: ollama
  baseUrl: http://localhost:11434
  model: qwen2.5:7b
```

#### API Key 存储

- 通过环境变量注入，不写入 SQLite
- 敏感配置通过 Docker secrets 或 `.env` 文件管理
- 运维通过 Skill/Web 配置时，加密存储在 `notify_configs` 表

#### 分析引擎实现

```typescript
// notifier/analyzer.ts

interface AnalysisConfig {
  provider: 'openai' | 'ollama';
  apiKey?: string;           // OpenAI 需要
  baseUrl: string;
  model: string;
}

async function analyzeFailure(
  run: PipelineRun,
  config: AnalysisConfig
): Promise<FailureReport> {
  // 1. 读取执行日志
  const logs = await readLogFile(run.log_path);

  // 2. 提取错误片段 (截取最后 200 行 + 错误关键词附近)
  const errorContext = extractErrorContext(logs);

  // 3. 构造分析请求
  const analysisPrompt = `
分析以下流水线执行失败原因，输出 JSON 格式：
{
  "rootCause": "根本原因描述",
  "failedStep": "失败的具体步骤",
  "suggestions": ["修复建议1", "修复建议2"]
}

日志内容：
${errorContext}
`;

  // 4. 调用 LLM (统一 OpenAI 兼容接口)
  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey && { 'Authorization': `Bearer ${config.apiKey}` })
    },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: 'user', content: analysisPrompt }],
      temperature: 0.1,  // 低温度，保证分析一致性
      response_format: { type: 'json_object' }
    })
  });

  const result = await response.json();
  const analysis = JSON.parse(result.choices[0].message.content);

  // 5. 结构化报告
  return {
    rootCause: analysis.rootCause,
    failedStep: analysis.failedStep,
    suggestions: analysis.suggestions,
    rawLogs: logs
  };
}
```

#### 成本控制

| 模型 | 单次分析成本 | 适用场景 |
|------|-------------|---------|
| gpt-4o-mini | ~$0.001 | 生产环境推荐 |
| gpt-4o | ~$0.01 | 复杂日志分析 |
| ollama/qwen2.5:7b | 免费 | 隐私敏感/离线环境 |

---

## 10. 认证授权

### 10.1 MVP 阶段

- **本地账号体系**: 运维通过 Web 管理账号和角色
- **API Key**: 开发者拿到 API Key 配置到 IDE，通过 MCP/Skill 调用
- **角色**: `admin` (运维) / `developer` (开发者)

### 10.2 后续优先: LDAP 集成

- 对接企业已有的统一认证
- 有助于在企业内部推广

### 10.3 运维密钥

容器启动时自动生成 `QUNKINS_ADMIN_KEY`，用于运维 Skill 连接服务端。

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│   Qunkins Server Started                                │
│                                                         │
│   Web Dashboard: http://localhost:9800                  │
│   MCP Server:    http://localhost:9800/mcp              │
│                                                         │
│   ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                                         │
│   Admin Key (首次启动自动生成):                          │
│   qk_a1b2c3d4e5f6789012345678                           │
│                                                         │
│   ⚠️  请妥善保管此密钥，用于运维 Skill 连接              │
│   📁 也可在 /app/data/admin.key 中查看                  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

---

## 11. 部署架构

### 11.1 Docker Compose

```yaml
version: "3.8"

services:
  qunkins:
    image: qunkins/server:latest
    container_name: qunkins-server
    ports:
      - "9800:9800"
    environment:
      - NODE_ENV=production
      - QUNKINS_SECRET=${QUNKINS_SECRET:-}
      - QUNKINS_PORT=9800
      - QUNKINS_DB_PATH=/app/data/qunkins.db
    volumes:
      - qunkins-data:/app/data
      - qunkins-logs:/app/logs
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:9800/health"]
      interval: 30s
      timeout: 5s
      retries: 3

  prometheus:
    image: prom/prometheus:latest
    container_name: qunkins-prometheus
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus-data:/prometheus
    profiles:
      - monitoring

  grafana:
    image: grafana/grafana:latest
    container_name: qunkins-grafana
    ports:
      - "3000:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_PASSWORD:-admin}
    volumes:
      - grafana-data:/var/lib/grafana
    profiles:
      - monitoring

volumes:
  qunkins-data:
  qunkins-logs:
  prometheus-data:
  grafana-data:
```

### 11.2 启动方式

```bash
# 最小部署 (核心服务 + 轻量监控)
docker compose up -d
# 轻量监控: 每30分钟采集CPU/内存/磁盘，保留24小时，存入SQLite

# 完整部署 (含 Prometheus + Grafana 历史监控)
docker compose --profile monitoring up -d
```

### 11.3 监控分层

| 层级 | 功能 | 依赖 | 默认启用 |
|------|------|------|---------|
| 轻量监控 | 30分钟采集，24小时保留，SQLite 存储 | 内置 | ✅ |
| 完整监控 | 实时采集，长期存储，可视化面板 | Prometheus + Grafana | ❌ (--profile monitoring) |

---

## 12. 项目结构

```
qunkins/
├── packages/
│   ├── core/                    # @qunkins/core
│   │   ├── src/
│   │   │   ├── pipeline/        # 流水线引擎
│   │   │   ├── docker/          # Docker 检查
│   │   │   ├── auth/            # 认证授权
│   │   │   ├── crypto/          # 加密模块
│   │   │   ├── notifier/        # 通知模块
│   │   │   ├── monitor/         # 监控适配
│   │   │   ├── skill/           # Skill 生成
│   │   │   ├── store/           # 数据存储
│   │   │   └── config/          # 配置管理
│   │   └── package.json
│   │
│   ├── server/                  # @qunkins/server
│   │   ├── src/
│   │   │   ├── api/             # REST API
│   │   │   ├── mcp/             # MCP Server
│   │   │   ├── webhook/         # 飞书 Webhook
│   │   │   └── index.ts         # 入口
│   │   └── package.json
│   │
│   ├── web/                     # @qunkins/web
│   │   ├── src/
│   │   │   ├── pages/           # Dashboard 页面
│   │   │   ├── components/      # UI 组件
│   │   │   └── App.tsx
│   │   └── package.json
│   │
│   └── skills/                  # @qunkins/skills
│       ├── operator/            # 运维 Skill
│       │   ├── SKILL.md
│       │   └── rules/           # 内置检查规则
│       └── developer/           # 开发者 Skill
│           ├── SKILL.md
│           └── rules/           # 内置检查规则
│
├── docker/
│   ├── Dockerfile               # 多阶段构建
│   ├── docker-compose.yml
│   └── prometheus.yml
│
├── docs/
│   └── ...
│
├── pnpm-workspace.yaml
├── turbo.json
└── package.json
```

---

## 13. License

Apache 2.0

---

*Document generated: 2026-03-24*
