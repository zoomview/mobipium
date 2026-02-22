# Mobipium Monitor - 部署指南

## 前置要求

1. **Vercel 账号**: https://vercel.com
2. **PostgreSQL 数据库**: Neon / Supabase / Railway 等
3. **Resend 账号** (可选): https://resend.com

---

## 快速部署步骤

### 1. 创建数据库

推荐使用 Neon (免费):
1. 访问 https://neon.tech
2. 创建新项目，获取 connection string
3. 格式: `postgresql://user:password@ep-xxx.us-east-1.aws.neon.tech/mobipium?sslmode=require`

### 2. 配置环境变量

复制 `.env.example` 为 `.env`:

```bash
cp .env.example .env
```

编辑 `.env`:
```env
# 数据库 (Neon PostgreSQL)
DATABASE_URL=postgresql://user:password@ep-xxx.us-east-1.aws.neon.tech/mobipium?sslmode=require

# Mobipium API Token
MOBIPIUM_API_TOKEN=18992:6925a4ca2e0b56925a4ca2e0b86925a4ca2e0b9

# Resend API Key (从 https://resend.com 获取)
RESEND_API_KEY=re_xxxxx

# 告警接收邮箱
ALERT_EMAIL=zoomview@163.com

# 告警阈值 (分钟)
ALERT_THRESHOLD_MINUTES=10
```

### 3. 推送数据库 Schema

```bash
npx prisma db push
```

### 4. 部署到 Vercel

**方式 A: CLI 部署**
```bash
vercel login
vercel --prod
```

**方式 B: GitHub 部署**
1. 将代码推送到 GitHub
2. 访问 https://vercel.com/new
3. 导入 GitHub 仓库
4. 在 Vercel 控制台添加环境变量
5. Deploy

### 5. 配置 Cron Job

部署后，在 Vercel 控制台:
1. 进入项目 Settings → Cron Jobs
2. 确保 `/api/cron` 已配置，每5分钟执行

---

## 验证部署

1. 访问 `https://your-project.vercel.app`
2. 手动触发 cron: `curl https://your-project.vercel.app/api/cron`
3. 查看数据库是否有数据

---

## 本地开发

```bash
# 安装依赖
npm install

# 配置 .env
cp .env.example .env
# 编辑 .env 填入真实数据库 URL

# 推送数据库
npx prisma db push

# 启动开发服务器
npm run dev
```

访问 http://localhost:3000
