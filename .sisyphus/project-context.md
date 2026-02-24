# 项目需求参考文档

本文档记录 Mobipium 项目的背景和需求，仅供参考。随着开发进行会不断更新。

---

## 项目目标

**Mobipium Offer 监控系统**
- 从 Mobipium CPA 网络定时抓取 Offer 数据
- 追踪历史转化记录
- 对异常转化进行告警

---

## 技术栈

| 技术 | 说明 |
|------|------|
| 框架 | Next.js 14 |
| 语言 | TypeScript |
| 数据库 | PostgreSQL (Neon) |
| ORM | Prisma |
| 队列 | Redis + Bull |
| 告警 | Resend 邮件 |
| 部署 | 阿里云服务器 |

---

## 用户需求（不断变化）

### 状态相关
- 用户只关注 **Active** 状态的 Offer
- Mobipium API 返回 "Unknown" = 用户看到的 "Cancelled"
- 需要在前端筛选中显示 Unknown 状态

### 转化时间
- 按 last_conv 排序（最近转化的排在前面）
- 支持的格式：51min, 6h18min, just now, < 1m 等
- 前端需要正确解析这些格式

### 告警场景
- 转化时间激增（从 <1min 变成 >10min）
- 转化时间倍增（增长超过 5 倍）
- 转化突然消失
- 状态变更（Active → 其他）

---

## 当前待解决的问题

（随时更新）

### 已完成
- [x] Redis 消息队列改造
- [x] 前端支持 Unknown 状态筛选
- [x] 修复转化时间解析（51min, 6h18min 格式）

### 待处理
- [ ] 待添加

---

## 数据模型

### Offer 表
- id (offer_id)
- offerName
- status (Active/Paused/Blocked/Unknown)
- lastConv (DateTime)
- lastConvRaw (原始字符串)
- hasConversion (boolean)
- priority (HIGH/LOW)

### OfferSnapshot 表
- 历史快照，用于追踪变化

### ConversionList 表
- 存储有转化的 Offer ID

### AlertHistory 表
- 告警记录

---

## 注意事项

1. Neon 免费 tier 有连接数限制
2. 阿里云 Redis 密码：mobipium2024
3. API 限流：需要指数退避重试
4. 并发控制：使用 p-limit

---

## 更新日志

- 2024-02-24: 创建文档，添加 Redis 队列改造背景
- 2024-02-24: 添加 Unknown 状态、前端解析修复的背景
