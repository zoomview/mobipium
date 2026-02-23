# 整改工作计划：消息队列任务调度

## 概述

基于整改方案A，引入 Redis + Bull 消息队列，将任务调度与执行完全解耦，解决当前系统的任务并发冲突问题。

---

## 实施步骤

### 阶段一：基础设施准备

#### 1.1 安装 Redis（阿里云服务器）

```bash
# SSH 登录阿里云服务器后执行

# 1. 安装 Redis (Alibaba Cloud Linux/CentOS)
sudo yum install redis -y

# 2. 配置 Redis
sudo nano /etc/redis.conf

# 需要修改的配置：
# bind 127.0.0.1 → bind 0.0.0.0
# # requirepass foobared → requirepass your_redis_password
# protected-mode yes → protected-mode no
```

#### 1.2 添加环境变量

在 `.env` 中添加：

```bash
# Redis 配置
REDIS_URL=redis://:your_redis_password@127.0.0.1:6379
```

#### 1.3 安装 npm 依赖

```bash
npm install bull bull-board ioredis
npm install -D @types/bull
```

---

### 阶段二：代码改造

#### 2.1 创建队列配置文件

**文件**: `lib/queue.ts`

```typescript
import Queue from 'bull'
import Redis from 'ioredis'

// Redis 连接配置
const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379'

// 创建 Redis 客户端（用于 Bull）
export const redisClient = new Redis(redisUrl)

// HIGH 优先级队列 - 每2分钟执行
export const highPriorityQueue = new Queue('high-priority', redisUrl, {
  redis: {
    enableOfflineQueue: true,
  },
  limiter: {
    max: 1,           // 每秒最多1个任务
    duration: 2000,   // 2秒内只能执行1个
  },
  defaultJobOptions: {
    priority: 1,      // 高优先级
    removeOnComplete: true,
    removeOnFail: false,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
  },
})

// FULL 全量抓取队列 - 分片任务
export const fullSyncQueue = new Queue('full-sync-chunk', redisUrl, {
  redis: {
    enableOfflineQueue: true,
  },
  limiter: {
    max: 2,           // 每秒最多2个分片
    duration: 1000,
  },
  defaultJobOptions: {
    priority: 2,      // 低优先级
    removeOnComplete: true,
    removeOnFail: false,
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
  },
})

// 队列事件监听
highPriorityQueue.on('completed', (job) => {
  console.log(`[Queue] HIGH job ${job.id} completed`)
})

fullSyncQueue.on('completed', (job) => {
  console.log(`[Queue] FULL chunk ${job.id} completed`)
})

highPriorityQueue.on('failed', (job, err) => {
  console.error(`[Queue] HIGH job ${job?.id} failed:`, err.message)
})

fullSyncQueue.on('failed', (job, err) => {
  console.error(`[Queue] FULL chunk ${job?.id} failed:`, err.message)
})
```

#### 2.2 提取抓取逻辑为独立函数

将 `app/api/cron/route.ts` 中的抓取逻辑拆分为：

- `processHighPriorityFetch()` - HIGH 优先级抓取
- `processFullChunkFetch(startPage, endPage, concurrency, status)` - FULL 分片抓取

**新增文件**: `lib/tasks/fetchTasks.ts`

```typescript
// 从现有 cron/route.ts 提取的抓取逻辑
export async function processHighPriorityFetch() {
  // 实现 HIGH 抓取逻辑
}

export async function processFullChunkFetch(
  startPage: number, 
  endPage: number, 
  concurrency: number, 
  status: string
) {
  // 实现分片抓取逻辑
}
```

#### 2.3 创建 Worker 处理器

**新增文件**: `worker.ts`

```typescript
import Queue from 'bull'
import { processHighPriorityFetch } from './lib/tasks/fetchTasks'
import { processFullChunkFetch } from './lib/tasks/fetchTasks'

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379'

// 创建队列（与 producer 共用配置）
const highPriorityQueue = new Queue('high-priority', redisUrl)
const fullSyncQueue = new Queue('full-sync-chunk', redisUrl)

console.log('[Worker] Starting worker...')

// 处理 HIGH 任务
highPriorityQueue.process(async (job) => {
  console.log(`[Worker] Processing HIGH task ${job.id}`)
  await processHighPriorityFetch()
})

// 处理 FULL 分片任务
fullSyncQueue.process(async (job) => {
  const { startPage, endPage, concurrency, status } = job.data
  console.log(`[Worker] Processing FULL chunk pages ${startPage}-${endPage}`)
  await processFullChunkFetch(startPage, endPage, concurrency, status)
})

console.log('[Worker] Worker started, listening for jobs...')
```

#### 2.4 改造 /api/cron 为 Producer

**修改**: `app/api/cron/route.ts`

将原有直接执行逻辑改为向队列添加任务：

```typescript
import { highPriorityQueue, fullSyncQueue } from '@/lib/queue'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const fetchByPriority = searchParams.get('fetchByPriority')
  const maxPages = parseInt(searchParams.get('maxPages') || '0')
  const concurrency = parseInt(searchParams.get('concurrency') || '10')
  const status = searchParams.get('status') || 'Active'

  // HIGH 优先级任务
  if (fetchByPriority === 'HIGH') {
    await highPriorityQueue.add('high-fetch', {
      timestamp: Date.now(),
      concurrency: 5,
      status,
    }, {
      jobId: `high-${Date.now()}`,
    })
    return NextResponse.json({ queued: true, queue: 'high-priority' })
  }

  // FULL 全量任务 - 拆分为分片
  if (maxPages > 0) {
    const chunkSize = 10
    const chunks = []
    
    for (let startPage = 1; startPage <= maxPages; startPage += chunkSize) {
      const endPage = Math.min(startPage + chunkSize - 1, maxPages)
      chunks.push({ startPage, endPage, concurrency, status })
    }

    // 添加所有分片任务
    for (const chunk of chunks) {
      await fullSyncQueue.add('full-chunk', chunk, {
        jobId: `full-${chunk.startPage}-${chunk.endPage}`,
      })
    }
    
    return NextResponse.json({ 
      queued: true, 
      queue: 'full-sync-chunk', 
      chunks: chunks.length 
    })
  }

  // 其他情况...
}
```

---

### 阶段三：数据一致性处理

#### 3.1 转化列表更新逻辑优化

问题：HIGH 和 FULL 可能同时更新 ConversionList

**解决方案**：

```typescript
// 在 ConversionList 更新时增加协调逻辑

// 方案A：HIGH 任务完成后更新，FULL 任务不更新
// - HIGH 任务：替换整个列表
// - FULL 任务：只更新数据，不更新列表
// - 定期（如每小时）由独立任务汇总 FULL 数据更新列表

// 方案B：使用 Redis 锁
// - 更新列表前先获取锁
// - 完成后释放锁
```

**推荐方案A**，简化实现：

```typescript
// 修改抓取逻辑：
// - HIGH 任务：更新 Offer + 替换 ConversionList
// - FULL 分片任务：只更新 Offer，不更新 ConversionList
// - 新增独立任务：每小时汇总 FULL 数据到 ConversionList
```

---

### 阶段四：部署配置

#### 4.1 构建 worker

在 `package.json` 添加：

```json
{
  "scripts": {
    "worker": "npx ts-node worker.ts",
    "build:worker": "tsc worker.ts --outDir dist"
  }
}
```

#### 4.2 PM2 配置

**新增文件**: `ecosystem.config.js`

```javascript
module.exports = {
  apps: [
    {
      name: 'mobipium-worker',
      script: 'worker.ts',
      interpreter: 'ts-node',
      watch: false,
      autorestart: true,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        DATABASE_URL: process.env.DATABASE_URL,
        REDIS_URL: process.env.REDIS_URL,
      },
    },
  ],
}
```

#### 4.3 部署命令

```bash
# 1. 构建 Next.js
npm run build

# 2. 启动 worker
pm2 start ecosystem.config.js

# 3. 部署 Next.js（使用现有部署方式）
```

---

### 阶段五：测试验证

#### 5.1 本地测试

```bash
# 1. 启动 Redis（本地）
redis-server

# 2. 启动 worker
npm run worker

# 3. 触发 HIGH 任务
curl "http://localhost:3000/api/cron?fetchByPriority=HIGH"

# 4. 触发 FULL 任务
curl "http://localhost:3000/api/cron?maxPages=20&concurrency=10&status=Active"

# 5. 查看 worker 日志
pm2 logs mobipium-worker
```

#### 5.2 监控

使用 bull-board 查看队列状态：

```typescript
// 新增 API: /api/queues
import { createBullBoard } from 'bull-board'
import { highPriorityQueue, fullSyncQueue } from '@/lib/queue'

const { router, setQueues } = createBullBoard([highPriorityQueue, fullSyncQueue])

// 挂载到 Next.js
// GET /api/queues
```

---

## 任务清单

| # | 任务 | 依赖 | 状态 |
|---|------|------|------|
| 1 | 在阿里云安装 Redis | - | 待确认 |
| 2 | 配置 Redis（密码、端口） | 1 | 待确认 |
| 3 | 安装 npm 依赖 (bull, bull-board, ioredis) | - | 待执行 |
| 4 | 创建 lib/queue.ts | 3 | 待执行 |
| 5 | 提取抓取逻辑到 lib/tasks/fetchTasks.ts | - | 待执行 |
| 6 | 改造 /api/cron 为 Producer | 4, 5 | 待执行 |
| 7 | 创建 worker.ts | 4, 5 | 待执行 |
| 8 | 优化 ConversionList 更新逻辑 | 5 | 待执行 |
| 9 | 添加 PM2 配置 | 7 | 待执行 |
| 10 | 本地测试 | 8 | 待执行 |
| 11 | 部署到阿里云 | 1-9 | 待确认 |
| 12 | 验证任务调度 | 11 | 待确认 |

---

## 预计工作量

| 阶段 | 工作量 |
|------|--------|
| 基础设施 | 30 分钟 |
| 代码改造 | 2-3 小时 |
| 测试验证 | 1 小时 |
| **总计** | **4-5 小时** |

---

## 待确认事项

1. **Redis 安装**: 是否已在阿里云执行？需要我提供详细的 SSH 命令吗？
2. **环境变量**: Redis 密码准备好了吗？
3. **部署方式**: 是否继续使用现有的 Aliyun 部署方式？
